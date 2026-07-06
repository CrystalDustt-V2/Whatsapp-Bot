import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import type { BotContext, Command } from '../types';
import { CommandCategory } from '../types';

type Product = {
  id: string;
  name: string;
  price: number;
  stock: number;
  description: string;
};

type OrderStatus = 'pending' | 'paid' | 'shipped' | 'done' | 'cancelled';

type Order = {
  id: string;
  productId: string;
  productName: string;
  buyerJid: string;
  buyerName: string;
  quantity: number;
  total: number;
  status: OrderStatus;
  createdAt: string;
};

type MarketplaceState = {
  products: Record<string, Product>;
  orders: Record<string, Order>;
};

const DATA_PATH = path.join(config.SESSION_PATH, 'marketplace.json');
const STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'done', 'cancelled'];

// ponytail: JSON store is fine for one small shop bot; move to DB when orders become real money workflow.
function loadState(): MarketplaceState {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) as MarketplaceState;
  } catch {
    return { products: {}, orders: {} };
  }
}

function saveState(state: MarketplaceState): void {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(state, null, 2));
}

function isOwner(ctx: BotContext): boolean {
  const owner = config.OWNER_NUMBER?.replace(/\D/g, '');
  return ctx.sender.fromMe || Boolean(owner && ctx.sender.phoneNumber.replace(/\D/g, '') === owner);
}

function money(value: number): string {
  return `${Math.floor(value)} coins`;
}

function productId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function orderId(): string {
  return `ord-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function parseQty(raw: string | undefined): number | null {
  const value = Number(raw || 1);
  return Number.isInteger(value) && value > 0 && value <= 1000 ? value : null;
}

function command(name: string, aliases: string[], description: string, usage: string, execute: Command['execute']): Command {
  return { name, aliases, category: CommandCategory.MARKETPLACE, description, usage, execute };
}

async function requireOwner(ctx: BotContext): Promise<boolean> {
  if (isOwner(ctx)) return true;
  await ctx.reply('Owner only.');
  return false;
}

function formatProduct(product: Product): string {
  return `${product.id} - ${product.name}\nPrice: ${money(product.price)}\nStock: ${product.stock}\n${product.description}`;
}

function formatOrder(order: Order): string {
  return (
    `Invoice ${order.id}\n` +
    `Buyer: ${order.buyerName}\n` +
    `Item: ${order.productName} (${order.productId})\n` +
    `Qty: ${order.quantity}\n` +
    `Total: ${money(order.total)}\n` +
    `Status: ${order.status}`
  );
}

export const CatalogCommand = command('catalog', ['products', 'productcatalog'], 'Show product catalog', 'catalog [query]', async (ctx) => {
  const state = loadState();
  const query = ctx.args.join(' ').toLowerCase();
  const products = Object.values(state.products)
    .filter((product) => !query || product.id.includes(query) || product.name.toLowerCase().includes(query))
    .slice(0, 10);

  await ctx.reply(
    products.length
      ? `Catalog\n${products.map((product) => `- ${product.id}: ${product.name} - ${money(product.price)} (${product.stock} left)`).join('\n')}\n\nUse .product <id> or .order <id> [qty]`
      : 'Catalog empty.'
  );
});

export const ProductCommand = command('product', ['item'], 'Show one product', 'product <id>', async (ctx) => {
  const state = loadState();
  const product = state.products[productId(ctx.args[0] || '')];
  await ctx.reply(product ? formatProduct(product) : 'Product not found.');
});

export const StockCommand = command('stock', ['stockcheck'], 'Check product stock', 'stock <id>', async (ctx) => {
  const state = loadState();
  const product = state.products[productId(ctx.args[0] || '')];
  await ctx.reply(product ? `${product.name}: ${product.stock} in stock.` : 'Product not found.');
});

export const OrderCommand = command('order', ['buyproduct'], 'Create an order', 'order <product-id> [qty]', async (ctx) => {
  const state = loadState();
  const id = productId(ctx.args[0] || '');
  const qty = parseQty(ctx.args[1]);
  const product = state.products[id];

  if (!product || !qty) {
    await ctx.reply('Usage: .order <product-id> [qty]');
    return;
  }
  if (product.stock < qty) {
    await ctx.reply(`Not enough stock. ${product.name}: ${product.stock} left.`);
    return;
  }

  product.stock -= qty;
  const order: Order = {
    id: orderId(),
    productId: product.id,
    productName: product.name,
    buyerJid: ctx.sender.jid,
    buyerName: ctx.sender.displayName,
    quantity: qty,
    total: product.price * qty,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  state.orders[order.id] = order;
  saveState(state);
  await ctx.reply(`${formatOrder(order)}\n\nUse .paymentqr ${order.id}`);
});

export const InvoiceCommand = command('invoice', ['invorder'], 'Show order invoice', 'invoice <order-id>', async (ctx) => {
  const state = loadState();
  const order = state.orders[ctx.args[0] || ''];
  await ctx.reply(order ? formatOrder(order) : 'Order not found.');
});

export const OrderTrackCommand = command('trackorder', ['ordertrack', 'orderstatus'], 'Track an order', 'trackorder <order-id>', async (ctx) => {
  const state = loadState();
  const order = state.orders[ctx.args[0] || ''];
  await ctx.reply(order ? `Order ${order.id}: ${order.status}` : 'Order not found.');
});

export const PaymentQrCommand = command('paymentqr', ['payment', 'payqr'], 'Show payment instructions', 'paymentqr [order-id]', async (ctx) => {
  const state = loadState();
  const order = ctx.args[0] ? state.orders[ctx.args[0]] : undefined;
  const payment = config.DONATE_TEXT || 'Payment QR/instructions not configured.';
  await ctx.reply(`${order ? `${formatOrder(order)}\n\n` : ''}${payment}`);
});

export const AddProductCommand = command('addproduct', ['productadd'], 'Owner: add/update product', 'addproduct <id> | <name> | <price> | <stock> | <description>', async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const [rawId, name, rawPrice, rawStock, description = ''] = (ctx.rawArgs || ctx.args.join(' '))
    .split('|')
    .map((part) => part.trim());
  const id = productId(rawId || '');
  const price = Number(rawPrice);
  const stock = Number(rawStock);
  if (!id || !name || !Number.isInteger(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
    await ctx.reply('Usage: .addproduct <id> | <name> | <price> | <stock> | <description>');
    return;
  }

  const state = loadState();
  state.products[id] = { id, name, price, stock, description };
  saveState(state);
  await ctx.reply(`Saved product ${id}.`);
});

export const SetStockCommand = command('setstock', ['stockset'], 'Owner: set product stock', 'setstock <id> <stock>', async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const state = loadState();
  const product = state.products[productId(ctx.args[0] || '')];
  const stock = Number(ctx.args[1]);
  if (!product || !Number.isInteger(stock) || stock < 0) {
    await ctx.reply('Usage: .setstock <id> <stock>');
    return;
  }

  product.stock = stock;
  saveState(state);
  await ctx.reply(`${product.name} stock set to ${stock}.`);
});

export const SetOrderStatusCommand = command('setorder', ['setorderstatus'], 'Owner: update order status', 'setorder <order-id> <status>', async (ctx) => {
  if (!(await requireOwner(ctx))) return;

  const state = loadState();
  const order = state.orders[ctx.args[0] || ''];
  const status = ctx.args[1] as OrderStatus | undefined;
  if (!order || !status || !STATUSES.includes(status)) {
    await ctx.reply(`Usage: .setorder <order-id> <${STATUSES.join('|')}>`);
    return;
  }

  if (status === 'cancelled' && order.status !== 'cancelled') {
    const product = state.products[order.productId];
    if (product) product.stock += order.quantity;
  }
  order.status = status;
  saveState(state);
  await ctx.reply(`Order ${order.id} set to ${status}.`);
});

export const MarketplaceCommands = [
  CatalogCommand,
  ProductCommand,
  StockCommand,
  OrderCommand,
  InvoiceCommand,
  OrderTrackCommand,
  PaymentQrCommand,
  AddProductCommand,
  SetStockCommand,
  SetOrderStatusCommand,
];
