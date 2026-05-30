import '@shopify/shopify-api/adapters/node';
import { shopifyApi, ApiVersion, Session } from '@shopify/shopify-api';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';

const SESSIONS_FILE = join(process.cwd(), 'sessions.json');

export interface CartLineItem {
  variant_id: number;
  quantity: number;
  price: number;
  title?: string;
  variant_title?: string;
}

export interface CustomerForDraft {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  defaultAddress: {
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    country: string | null;
  } | null;
}

export interface DraftOrderResult {
  id: string;
  invoiceUrl: string;
}

let shopify: ReturnType<typeof shopifyApi> | null = null;

function getShopify() {
  if (!shopify) {
    const apiKey = process.env.SHOPIFY_API_KEY;
    const apiSecret = process.env.SHOPIFY_API_SECRET;
    const host = process.env.HOST?.replace(/\/$/, '');

    if (!apiKey || !apiSecret || !host) {
      throw new Error('Missing SHOPIFY_API_KEY, SHOPIFY_API_SECRET, or HOST');
    }

    shopify = shopifyApi({
      apiKey,
      apiSecretKey: apiSecret,
      scopes: (
        process.env.SCOPES ||
        'write_draft_orders,read_draft_orders,read_customers,read_products'
      ).split(','),
      hostName: new URL(host).host,
      apiVersion: ApiVersion.January25,
      isEmbeddedApp: true,
    });
  }
  return shopify;
}

function loadSessions(): Record<string, Session> {
  if (!existsSync(SESSIONS_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')) as Record<string, Session>;
    return raw;
  } catch {
    return {};
  }
}

function saveSessions(sessions: Record<string, Session>): void {
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}

export function storeSession(session: Session): void {
  const sessions = loadSessions();
  sessions[session.id] = session;
  saveSessions(sessions);
}

export async function getOfflineSession(shop: string): Promise<Session | null> {
  const sessions = loadSessions();
  const sessionId = getShopify().session.getOfflineId(shop);
  return sessions[sessionId] ?? null;
}

export async function graphqlRequest<T>(
  session: Session,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const client = new (getShopify().clients.Graphql)({ session });
  const response = await client.request(query, { variables });
  return response.data as T;
}

const CUSTOMER_QUERY = `
  query GetCustomer($id: ID!) {
    customer(id: $id) {
      id
      firstName
      lastName
      email
      phone
      defaultAddress {
        address1
        address2
        city
        province
        zip
        country
      }
      companyContactProfiles(first: 1) {
        edges {
          node {
            company {
              name
            }
          }
        }
      }
    }
  }
`;

export async function getCustomerForDraftOrder(
  session: Session,
  customerId: number
): Promise<CustomerForDraft | null> {
  const gid = `gid://shopify/Customer/${customerId}`;

  const data = await graphqlRequest<{
    customer: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
      defaultAddress: CustomerForDraft['defaultAddress'];
      companyContactProfiles: {
        edges: Array<{ node: { company: { name: string } | null } }>;
      };
    } | null;
  }>(session, CUSTOMER_QUERY, { id: gid });

  if (!data.customer) return null;

  const companyName =
    data.customer.companyContactProfiles?.edges?.[0]?.node?.company?.name ?? null;

  return {
    id: data.customer.id,
    firstName: data.customer.firstName,
    lastName: data.customer.lastName,
    email: data.customer.email,
    phone: data.customer.phone,
    companyName,
    defaultAddress: data.customer.defaultAddress,
  };
}

function formatAddress(addr: CustomerForDraft['defaultAddress']): string {
  if (!addr) return '';
  return [addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country]
    .filter(Boolean)
    .join(', ');
}

function addDays(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const DRAFT_ORDER_CREATE = `
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        invoiceUrl
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const METAFIELDS_SET = `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export interface CreateQuoteDraftInput {
  customerGid: string;
  items: CartLineItem[];
  cartToken: string;
  cartNote?: string;
  customer: CustomerForDraft;
}

export async function createQuoteDraftOrder(
  session: Session,
  input: CreateQuoteDraftInput
): Promise<DraftOrderResult> {
  const { customer, items, cartToken, cartNote } = input;
  const companyName = customer.companyName || '';
  const shippingAddress = formatAddress(customer.defaultAddress);

  const noteLines = [
    'B2B quote request submitted from the wholesale portal.',
    customer.email ? `Email: ${customer.email}` : null,
    customer.phone ? `Phone: ${customer.phone}` : null,
    companyName ? `Company: ${companyName}` : null,
    shippingAddress ? `Address: ${shippingAddress}` : null,
    cartNote ? `Cart note: ${cartNote}` : null,
  ].filter(Boolean);

  const draftInput = {
    customerId: input.customerGid,
    lineItems: items.map((item) => ({
      variantId: `gid://shopify/ProductVariant/${item.variant_id}`,
      quantity: item.quantity,
      originalUnitPrice: (item.price / 100).toFixed(2),
    })),
    tags: ['b2b-request', 'quote-request', 'solicitud-cotización'],
    note: noteLines.join('\n'),
    customAttributes: [
      { key: 'company_name', value: companyName },
      { key: 'shipping_address', value: shippingAddress },
      { key: 'cart_token', value: cartToken },
      { key: 'source', value: 'b2b-quote-button' },
    ],
    reserveInventoryUntil: addDays(new Date(), 7),
  };

  const data = await graphqlRequest<{
    draftOrderCreate: {
      draftOrder: { id: string; invoiceUrl: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(session, DRAFT_ORDER_CREATE, { input: draftInput });

  const { draftOrder, userErrors } = data.draftOrderCreate;

  if (userErrors?.length) {
    const msg = userErrors.map((e) => e.message).join('; ');
    logger.error('draftOrderCreate userErrors', { error: msg });
    throw new Error(msg);
  }

  if (!draftOrder) {
    throw new Error('Draft order was not created');
  }

  try {
    await graphqlRequest(session, METAFIELDS_SET, {
      metafields: [
        {
          ownerId: draftOrder.id,
          namespace: 'b2b_quote',
          key: 'company_name',
          type: 'single_line_text_field',
          value: companyName || 'N/A',
        },
        {
          ownerId: draftOrder.id,
          namespace: 'b2b_quote',
          key: 'shipping_address',
          type: 'multi_line_text_field',
          value: shippingAddress || 'N/A',
        },
      ],
    });
  } catch (err) {
    logger.warn('metafieldsSet failed (draft still created)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { id: draftOrder.id, invoiceUrl: draftOrder.invoiceUrl };
}

export interface QuoteDraftSummary {
  id: string;
  name: string;
  createdAt: string;
  customerName: string;
  adminUrl: string;
  invoiceUrl: string;
}

const DRAFT_ORDERS_LIST = `
  query ListQuoteDrafts($first: Int!, $query: String!) {
    draftOrders(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          invoiceUrl
          customer {
            displayName
            email
          }
        }
      }
    }
  }
`;

function draftOrderAdminUrl(shop: string, gid: string): string {
  const numericId = gid.split('/').pop() || gid;
  return `https://${shop}/admin/draft_orders/${numericId}`;
}

export async function listRecentQuoteDraftOrders(
  session: Session,
  shop: string,
  limit = 15
): Promise<QuoteDraftSummary[]> {
  const query =
    'tag:quote-request OR tag:solicitud-cotización OR tag:b2b-request';

  const data = await graphqlRequest<{
    draftOrders: {
      edges: Array<{
        node: {
          id: string;
          name: string;
          createdAt: string;
          invoiceUrl: string;
          customer: { displayName: string | null; email: string | null } | null;
        };
      }>;
    };
  }>(session, DRAFT_ORDERS_LIST, { first: limit, query });

  return data.draftOrders.edges.map(({ node }) => ({
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    customerName:
      node.customer?.displayName ||
      node.customer?.email ||
      '—',
    adminUrl: draftOrderAdminUrl(shop, node.id),
    invoiceUrl: node.invoiceUrl,
  }));
}

export function getShopifyAuth(): ReturnType<typeof shopifyApi> {
  return getShopify();
}
