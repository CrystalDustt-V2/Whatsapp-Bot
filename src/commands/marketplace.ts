import * as fs from 'fs';
import * as path from 'path';
import config from '../config';
import type { BotContext, Command } from '../types';
import { CommandCategory, PermissionLevel } from '../types';
import { downloadMediaFromContext } from './media/helpers';
import { formatUsageError, formatFailed, formatSuccess } from '../core/response-formatter';

export type Product = {
  id: string;
  name: string;
  price: number;
  stock: number;
  description: string;
  category?: string;
  updatedAt?: string;
};

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'done' | 'cancelled';

export type Order = {
  id: string;
  productId: string;
  productName: string;
  buyerJid: string;
  buyerName: string;
  quantity: number;
  total: number;
  status: OrderStatus;
  createdAt: string;
  paymentProofAt?: string;
};

export type MarketplaceState = {
  products: Record<string, Product>;
  orders: Record<string, Order>;
};

const DATA_PATH = path.join(config.SESSION_PATH, 'marketplace.json');
const STATUSES: OrderStatus[] = ['pending', 'paid', 'shipped', 'done', 'cancelled'];

function loadState(): MarketplaceState {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) as MarketplaceState;
    data.products ||= {};
    data.orders ||= {};
    return data;
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

function ownerJid(): string | null {
  const owner = config.OWNER_NUMBER?.replace(/\D/g, '');
  return owner ? `${owner}@s.whatsapp.net` : null;
}

function money(value: number): string {
  return `${Math.floor(value).toLocaleString('en-US')} coins`;
}

function productId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function orderId(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function parseQty(raw: string | undefined): number | null {
  const value = Number(raw || 1);
  return Number.isInteger(value) && value > 0 && value <= 1000 ? value : null;
}

function statusBadge(status: OrderStatus): string {
  switch (status) {
    case 'pending': return '🟡 Pending Payment';
    case 'paid': return '🟢 Paid & Verified';
    case 'shipped': return '🚚 Shipped / In Transit';
    case 'done': return '✅ Completed';
    case 'cancelled': return '❌ Cancelled';
  }
}

function formatProduct(product: Product): string {
  return (
    `📦 *Product Details: ${product.name}*\n` +
    `• Product ID: \`${product.id}\`\n` +
    `• Price: *${money(product.price)}*\n` +
    `• In Stock: *${product.stock.toLocaleString()} available*\n` +
    (product.category ? `• Category: ${product.category}\n` : '') +
    `• Description: _${product.description || 'No description provided.'}_\n\n` +
    `👉 *To Order:* \`.order ${product.id} [quantity]\``
  );
}

function formatInvoice(order: Order): string {
  return [
    `🧾 *OFFICIAL INVOICE & ORDER RECEIPT*`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `• Invoice ID: *${order.id}*`,
    `• Order Date: ${new Date(order.createdAt).toLocaleString()}`,
    `• Customer: *${order.buyerName}*`,
    `• Item: *${order.productName}* (\`${order.productId}\`)`,
    `• Quantity: *${order.quantity.toLocaleString()}×*`,
    `• Total Amount: *${money(order.total)}*`,
    `• Status: ${statusBadge(order.status)}`,
    order.paymentProofAt ? `• Payment Proof: Submitted (${new Date(order.paymentProofAt).toLocaleTimeString()})` : undefined,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `\n💳 *Payment Instructions:*`,
    `Type \`.paymentqr ${order.id}\` for QR code and payment details.`,
    `Type \`.confirmorder ${order.id}\` (with payment receipt photo) to verify payment.`,
  ].filter(Boolean).join('\n');
}

export const CatalogCommand: Command = {
  name: 'catalog',
  aliases: ['products', 'storecatalog', 'marketcatalog'],
  category: CommandCategory.MARKETPLACE,
  description: 'Browse all available products, stock availability, and prices',
  usage: 'catalog [search_query]',
  examples: ['catalog', 'catalog vps', 'catalog discord'],
  inputs: 'Optional keyword or category search query',
  async execute(ctx) {
    const state = loadState();
    const query = ctx.args.join(' ').toLowerCase().trim();
    const products = Object.values(state.products)
      .filter((product) => !query || product.id.includes(query) || product.name.toLowerCase().includes(query) || (product.category && product.category.toLowerCase().includes(query)));

    if (!products.length) {
      await ctx.reply(
        query
          ? `🛍️ *Product Catalog*\n\nNo products found matching "${query}". Type \`.catalog\` to view all items.`
          : '🛍️ *Product Catalog*\n\nThe marketplace is currently empty. Store owners can add items using `.addproduct`.'
      );
      return;
    }

    const lines = products.slice(0, 15).map((p, idx) => {
      const stockText = p.stock > 0 ? `📦 ${p.stock} in stock` : '❌ *OUT OF STOCK*';
      return `${idx + 1}. *${p.name}* (\`${p.id}\`)\n   💰 ${money(p.price)} • ${stockText}\n   _${p.description.slice(0, 80)}_`;
    });

    const text = [
      `🛍️ *Official Marketplace Catalog*`,
      `Available Items: ${products.length} products\n`,
      lines.join('\n\n'),
      `\n👉 *View Item:* \`.product <id>\``,
      `👉 *Place Order:* \`.order <id> [qty]\` (e.g. \`.order ${products[0].id} 1\`)`,
    ].join('\n');

    await ctx.reply(text);
  },
};

export const ProductCommand: Command = {
  name: 'product',
  aliases: ['item', 'productinfo'],
  category: CommandCategory.MARKETPLACE,
  description: 'View full product specifications, price, and stock status',
  usage: 'product <product_id>',
  examples: ['product premium-pass', 'product vps-1gb'],
  inputs: 'Product ID',
  async execute(ctx) {
    const id = productId(ctx.args[0] || '');
    if (!id) {
      await ctx.reply(
        formatUsageError({
          command: 'product',
          reason: 'Product ID is required.',
          examples: ['product item-01', 'product nitro-1m'],
          hint: 'Type .catalog to browse all active product IDs.',
        })
      );
      return;
    }

    const state = loadState();
    const product = state.products[id];

    if (!product) {
      await ctx.reply(
        formatFailed({
          title: 'Product Lookup',
          reason: `No product found with ID "${id}".`,
          tryHint: 'Check .catalog for active product codes.',
        })
      );
      return;
    }

    await ctx.reply(formatProduct(product));
  },
};

export const StockCommand: Command = {
  name: 'stock',
  aliases: ['stockcheck', 'checkstock'],
  category: CommandCategory.MARKETPLACE,
  description: 'Quickly check inventory stock for a product',
  usage: 'stock <product_id>',
  examples: ['stock nitro-1m'],
  async execute(ctx) {
    const id = productId(ctx.args[0] || '');
    if (!id) {
      await ctx.reply('Usage: `.stock <product_id>`');
      return;
    }

    const state = loadState();
    const product = state.products[id];

    if (!product) {
      await ctx.reply(`❌ Product with ID "${id}" not found.`);
      return;
    }

    const statusText = product.stock > 0 ? `✅ *${product.stock.toLocaleString()} units in stock*` : '❌ *OUT OF STOCK*';
    await ctx.reply(`📦 *Stock Status: ${product.name}*\n• Product ID: \`${product.id}\`\n• Available: ${statusText}\n• Unit Price: ${money(product.price)}`);
  },
};

export const OrderCommand: Command = {
  name: 'order',
  aliases: ['buyproduct', 'purchaseproduct'],
  category: CommandCategory.MARKETPLACE,
  description: 'Place an order and generate an official invoice receipt',
  usage: 'order <product_id> [quantity]',
  examples: ['order nitro-1m', 'order vps-1 2'],
  inputs: 'Product ID and optional quantity',
  async execute(ctx) {
    const id = productId(ctx.args[0] || '');
    const qty = parseQty(ctx.args[1]) || 1;

    if (!id) {
      await ctx.reply(
        formatUsageError({
          command: 'order',
          reason: 'Product ID is required.',
          examples: ['order nitro-1m 1', 'order vps-1gb 2'],
          hint: 'Browse items with .catalog before ordering.',
        })
      );
      return;
    }

    const state = loadState();
    const product = state.products[id];

    if (!product) {
      await ctx.reply(
        formatFailed({
          title: 'Order Placement',
          reason: `Product "${id}" does not exist.`,
          tryHint: 'Check available items using .catalog',
        })
      );
      return;
    }

    if (product.stock < qty) {
      await ctx.reply(
        formatFailed({
          title: 'Insufficient Stock',
          reason: `Only ${product.stock} units of ${product.name} left (You requested ${qty}).`,
          tryHint: 'Order a smaller quantity or check back later.',
        })
      );
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

    await ctx.reply(formatInvoice(order));
  },
};

export const InvoiceCommand: Command = {
  name: 'invoice',
  aliases: ['invorder', 'receipt'],
  category: CommandCategory.MARKETPLACE,
  description: 'View the official invoice and payment receipt for an order',
  usage: 'invoice <order_id>',
  examples: ['invoice ORD-LZ123-A4B5'],
  inputs: 'Order ID',
  async execute(ctx) {
    const id = (ctx.args[0] || '').toUpperCase().trim();
    if (!id) {
      await ctx.reply(
        formatUsageError({
          command: 'invoice',
          reason: 'Order ID is required.',
          examples: ['invoice ORD-LZ123-A4B5'],
        })
      );
      return;
    }

    const state = loadState();
    const order = state.orders[id] || Object.values(state.orders).find((o) => o.id.toUpperCase() === id);

    if (!order) {
      await ctx.reply(
        formatFailed({
          title: 'Invoice Search',
          reason: `No invoice found with ID "${id}".`,
          tryHint: 'Check your active orders with .myorders',
        })
      );
      return;
    }

    await ctx.reply(formatInvoice(order));
  },
};

export const OrderTrackCommand: Command = {
  name: 'trackorder',
  aliases: ['ordertrack', 'orderstatus', 'checkorder'],
  category: CommandCategory.MARKETPLACE,
  description: 'Track the delivery and payment progress of an existing order',
  usage: 'trackorder <order_id>',
  examples: ['trackorder ORD-LZ123-A4B5'],
  inputs: 'Order ID',
  async execute(ctx) {
    const id = (ctx.args[0] || '').toUpperCase().trim();
    if (!id) {
      await ctx.reply('Usage: `.trackorder <order_id>`');
      return;
    }

    const state = loadState();
    const order = state.orders[id] || Object.values(state.orders).find((o) => o.id.toUpperCase() === id);

    if (!order) {
      await ctx.reply(`❌ Order "${id}" not found.`);
      return;
    }

    const lines = [
      `📦 *Order Tracking: ${order.id}*`,
      `• Status: ${statusBadge(order.status)}`,
      `• Product: *${order.productName}* (${order.quantity}×)`,
      `• Total: *${money(order.total)}*`,
      `• Placed on: ${new Date(order.createdAt).toLocaleDateString()}`,
    ];

    await ctx.reply(lines.join('\n'));
  },
};

export const MyOrdersCommand: Command = {
  name: 'myorders',
  aliases: ['orders', 'orderhistory'],
  category: CommandCategory.MARKETPLACE,
  description: 'View all your recent purchases and active orders',
  usage: 'myorders',
  examples: ['myorders', 'orders'],
  async execute(ctx) {
    const state = loadState();
    const myJid = ctx.sender.jid;
    const userOrders = Object.values(state.orders)
      .filter((o) => o.buyerJid === myJid)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (!userOrders.length) {
      await ctx.reply('🛍️ *My Orders*\n\nYou have not placed any orders yet. Browse products with `.catalog`.');
      return;
    }

    const lines = userOrders.slice(0, 10).map((o, idx) => {
      return `${idx + 1}. *${o.id}* — ${o.productName} (${o.quantity}×)\n   Status: ${statusBadge(o.status)} • Total: ${money(o.total)}`;
    });

    await ctx.reply(`🛍️ *Your Order History (${userOrders.length} orders)*\n\n${lines.join('\n\n')}\n\n👉 View details with \`.invoice <order_id>\``);
  },
};

export const CancelOrderCommand: Command = {
  name: 'cancelorder',
  aliases: ['ordercancel'],
  category: CommandCategory.MARKETPLACE,
  description: 'Cancel an unpaid pending order and restore item stock',
  usage: 'cancelorder <order_id>',
  examples: ['cancelorder ORD-LZ123-A4B5'],
  async execute(ctx) {
    const id = (ctx.args[0] || '').toUpperCase().trim();
    const state = loadState();
    const order = state.orders[id] || Object.values(state.orders).find((o) => o.id.toUpperCase() === id);

    if (!order) {
      await ctx.reply(`❌ Order "${id}" not found.`);
      return;
    }

    if (!isOwner(ctx) && order.buyerJid !== ctx.sender.jid) {
      await ctx.reply('❌ You can only cancel your own orders.');
      return;
    }

    if (order.status !== 'pending') {
      await ctx.reply(`⚠️ Cannot cancel an order with status "${order.status}". Only pending orders can be cancelled.`);
      return;
    }

    order.status = 'cancelled';
    const product = state.products[order.productId];
    if (product) {
      product.stock += order.quantity;
    }
    saveState(state);

    await ctx.reply(
      formatSuccess({
        title: 'Order Cancelled',
        fields: {
          'Order ID': order.id,
          'Restored Stock': `${order.quantity} units to ${order.productName}`,
        },
      })
    );
  },
};

export const PaymentQrCommand: Command = {
  name: 'paymentqr',
  aliases: ['payment', 'payqr', 'howtopay'],
  category: CommandCategory.MARKETPLACE,
  description: 'Display payment QR instructions and official merchant details',
  usage: 'paymentqr [order_id]',
  examples: ['paymentqr', 'paymentqr ORD-LZ123-A4B5'],
  async execute(ctx) {
    const state = loadState();
    const orderIdArg = (ctx.args[0] || '').toUpperCase().trim();
    const order = orderIdArg ? state.orders[orderIdArg] || Object.values(state.orders).find((o) => o.id.toUpperCase() === orderIdArg) : undefined;
    const payment = config.DONATE_TEXT || 'Payment instructions: Transfer via QRIS / Bank Transfer / E-Wallet.';

    const lines = [
      `💳 *Official Payment Instructions*`,
      order ? `\n${formatInvoice(order)}\n` : '',
      `━━━━━━━━━━━━━━━━━━━━━━`,
      payment,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `\n📸 *After paying:* Send your payment receipt with \`.confirmorder ${order ? order.id : '<order_id>'}\` to finalize!`,
    ].filter(Boolean);

    await ctx.reply(lines.join('\n'));
  },
};

export const ConfirmOrderCommand: Command = {
  name: 'confirmorder',
  aliases: ['confirmpayment', 'paymentproof', 'submitproof'],
  category: CommandCategory.MARKETPLACE,
  description: 'Submit payment proof (screenshot/receipt) to the merchant for verification',
  usage: 'confirmorder <order_id> (reply with receipt image/document)',
  examples: ['confirmorder ORD-LZ123-A4B5'],
  inputs: 'Order ID with attached or quoted payment receipt',
  async execute(ctx) {
    const state = loadState();
    const id = (ctx.args[0] || '').toUpperCase().trim();
    const order = state.orders[id] || Object.values(state.orders).find((o) => o.id.toUpperCase() === id);
    const owner = ownerJid();

    if (!id || !order) {
      await ctx.reply(
        formatUsageError({
          command: 'confirmorder',
          reason: 'Valid Order ID is required.',
          examples: ['confirmorder ORD-LZ123-A4B5 (reply to screenshot)'],
          hint: 'Reply to your payment receipt photo with .confirmorder <order_id>',
        })
      );
      return;
    }

    if (!owner) {
      await ctx.reply('❌ Merchant contact (OWNER_NUMBER) is not configured.');
      return;
    }

    if (!isOwner(ctx) && order.buyerJid !== ctx.sender.jid) {
      await ctx.reply('❌ Only the buyer who placed this order can submit payment proof.');
      return;
    }

    const media = await downloadMediaFromContext(ctx, ['image', 'document']);
    if (!media) {
      await ctx.reply(
        formatFailed({
          title: 'Payment Proof Submission',
          reason: 'No payment receipt image or document detected.',
          tryHint: 'Send or reply to your payment screenshot with .confirmorder <order_id>',
        })
      );
      return;
    }

    order.paymentProofAt = new Date().toISOString();
    saveState(state);

    const caption = `💰 *Payment Proof Received!*\n${formatInvoice(order)}\n\n• Buyer: ${ctx.sender.displayName} (${ctx.sender.phoneNumber})`;
    await ctx.socket.sendMessage(owner, media.kind === 'image'
      ? { image: media.buffer, mimetype: media.mimetype || 'image/jpeg', caption }
      : { document: media.buffer, mimetype: media.mimetype || 'application/octet-stream', fileName: media.fileName || `payment-${order.id}.${media.extension}`, caption }
    );

    await ctx.reply(
      formatSuccess({
        title: 'Payment Proof Submitted!',
        fields: {
          'Order ID': order.id,
          'Status': 'Sent to merchant for verification',
        },
        footer: 'You will receive delivery as soon as the merchant verifies your transfer.',
      })
    );
  },
};

// ----------------------------------------------------
// OWNER / ADMIN COMMANDS
// ----------------------------------------------------

export const AddProductCommand: Command = {
  name: 'addproduct',
  aliases: ['productadd', 'createproduct'],
  category: CommandCategory.MARKETPLACE,
  description: 'Owner: add a new product or update an existing one in the catalog',
  usage: 'addproduct <id> | <name> | <price> | <stock> | <description>',
  examples: ['addproduct vps-1gb | Fast VPS 1GB | 50000 | 10 | Cloud Linux VPS Server'],
  permissions: PermissionLevel.BOT_ADMIN,
  async execute(ctx) {
    if (!isOwner(ctx)) {
      await ctx.reply('🔒 This command is restricted to the bot owner/store administrator.');
      return;
    }

    const rawArgs = ctx.rawArgs || ctx.args.join(' ');
    const parts = rawArgs.split('|').map((part) => part.trim());
    if (parts.length < 4) {
      await ctx.reply(
        formatUsageError({
          command: 'addproduct',
          customUsage: 'addproduct <id> | <name> | <price> | <stock> | <description>',
          examples: ['addproduct netflix-1m | Netflix 1 Month | 35000 | 20 | UHD 4K Shared Profile'],
          hint: 'Separate all fields with the vertical bar "|" character.',
        })
      );
      return;
    }

    const [rawId, name, rawPrice, rawStock, description = ''] = parts;
    const id = productId(rawId);
    const price = Number(rawPrice);
    const stock = Number(rawStock);

    if (!id || !name || isNaN(price) || price < 0 || isNaN(stock) || stock < 0) {
      await ctx.reply('❌ Invalid format. Ensure price and stock are positive numbers.');
      return;
    }

    const state = loadState();
    state.products[id] = { id, name, price, stock, description, updatedAt: new Date().toISOString() };
    saveState(state);

    await ctx.reply(
      formatSuccess({
        title: 'Product Saved to Catalog',
        fields: {
          'ID': id,
          'Name': name,
          'Price': money(price),
          'Stock': `${stock} units`,
        },
      })
    );
  },
};

export const DeleteProductCommand: Command = {
  name: 'delproduct',
  aliases: ['deleteproduct', 'removeproduct'],
  category: CommandCategory.MARKETPLACE,
  description: 'Owner: delete a product from the marketplace catalog',
  usage: 'delproduct <product_id>',
  examples: ['delproduct vps-1gb'],
  permissions: PermissionLevel.BOT_ADMIN,
  async execute(ctx) {
    if (!isOwner(ctx)) {
      await ctx.reply('🔒 Restricted to the bot owner.');
      return;
    }

    const id = productId(ctx.args[0] || '');
    if (!id) {
      await ctx.reply('Usage: `.delproduct <product_id>`');
      return;
    }

    const state = loadState();
    if (!state.products[id]) {
      await ctx.reply(`❌ Product "${id}" does not exist.`);
      return;
    }

    const name = state.products[id].name;
    delete state.products[id];
    saveState(state);

    await ctx.reply(
      formatSuccess({
        title: 'Product Deleted',
        fields: {
          'Product': name,
          'ID': id,
        },
      })
    );
  },
};

export const SetStockCommand: Command = {
  name: 'setstock',
  aliases: ['stockset', 'updatestock'],
  category: CommandCategory.MARKETPLACE,
  description: 'Owner: update available stock for a product',
  usage: 'setstock <product_id> <new_stock>',
  examples: ['setstock nitro-1m 50'],
  permissions: PermissionLevel.BOT_ADMIN,
  async execute(ctx) {
    if (!isOwner(ctx)) {
      await ctx.reply('🔒 Restricted to the bot owner.');
      return;
    }

    const id = productId(ctx.args[0] || '');
    const stock = Number(ctx.args[1]);

    if (!id || isNaN(stock) || stock < 0) {
      await ctx.reply('Usage: `.setstock <product_id> <new_stock>`');
      return;
    }

    const state = loadState();
    const product = state.products[id];
    if (!product) {
      await ctx.reply(`❌ Product "${id}" not found.`);
      return;
    }

    product.stock = stock;
    saveState(state);

    await ctx.reply(
      formatSuccess({
        title: 'Stock Updated',
        fields: {
          'Product': product.name,
          'New Stock': `${stock} units`,
        },
      })
    );
  },
};

export const SetOrderStatusCommand: Command = {
  name: 'setorder',
  aliases: ['setorderstatus', 'updateorder'],
  category: CommandCategory.MARKETPLACE,
  description: 'Owner: update an order status (pending, paid, shipped, done, cancelled)',
  usage: 'setorder <order_id> <pending|paid|shipped|done|cancelled>',
  examples: ['setorder ORD-LZ123-A4B5 paid', 'setorder ORD-LZ123-A4B5 done'],
  permissions: PermissionLevel.BOT_ADMIN,
  async execute(ctx) {
    if (!isOwner(ctx)) {
      await ctx.reply('🔒 Restricted to the bot owner.');
      return;
    }

    const id = (ctx.args[0] || '').toUpperCase().trim();
    const status = (ctx.args[1] || '').toLowerCase() as OrderStatus;

    if (!id || !STATUSES.includes(status)) {
      await ctx.reply(`Usage: \`.setorder <order_id> <${STATUSES.join('|')}>\``);
      return;
    }

    const state = loadState();
    const order = state.orders[id] || Object.values(state.orders).find((o) => o.id.toUpperCase() === id);

    if (!order) {
      await ctx.reply(`❌ Order "${id}" not found.`);
      return;
    }

    // If order is cancelled, restore stock
    if (status === 'cancelled' && order.status !== 'cancelled') {
      const product = state.products[order.productId];
      if (product) product.stock += order.quantity;
    }

    order.status = status;
    saveState(state);

    // Notify buyer
    const notifyText = `📦 *Order Update: ${order.id}*\nStatus changed to: ${statusBadge(status)}\nItem: *${order.productName}* (${order.quantity}×)`;
    await ctx.socket.sendMessage(order.buyerJid, { text: notifyText }).catch(() => undefined);

    await ctx.reply(
      formatSuccess({
        title: 'Order Status Updated',
        fields: {
          'Order ID': order.id,
          'New Status': statusBadge(status),
          'Customer': order.buyerName,
        },
      })
    );
  },
};

export const MarketplaceCommands: Command[] = [
  CatalogCommand,
  ProductCommand,
  StockCommand,
  OrderCommand,
  InvoiceCommand,
  OrderTrackCommand,
  MyOrdersCommand,
  CancelOrderCommand,
  PaymentQrCommand,
  ConfirmOrderCommand,
  AddProductCommand,
  DeleteProductCommand,
  SetStockCommand,
  SetOrderStatusCommand,
];

export default MarketplaceCommands;
