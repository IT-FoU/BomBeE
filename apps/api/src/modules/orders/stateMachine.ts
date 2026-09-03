export const CHILD_STATUSES = [
  'pending_supplier',
  'partial_confirmed',
  'confirmed',
  'awaiting_payment',
  'awaiting_cod',
  'packing',
  'ready',
  'handed_to_courier',
  'in_transit',
  'delivered',
  'partial_cancelled',
  'cancelled',
  'delivery_failed',
  'return_requested',
  'refunded',
] as const;

export type ChildStatus = (typeof CHILD_STATUSES)[number];

export const PARENT_STATUSES = [
  'pending_supplier',
  'partial_confirmed',
  'awaiting_payment',
  'in_progress',
  'completed',
  'cancelled',
  'partial_cancelled',
] as const;

export type ParentStatus = (typeof PARENT_STATUSES)[number];

/** Allowed transitions only — anything else is rejected. */
export const ALLOWED_TRANSITIONS: Record<ChildStatus, readonly ChildStatus[]> = {
  pending_supplier: ['confirmed', 'partial_confirmed', 'cancelled'],
  partial_confirmed: ['confirmed', 'awaiting_payment', 'awaiting_cod', 'partial_cancelled', 'cancelled'],
  confirmed: ['awaiting_payment', 'awaiting_cod', 'packing', 'partial_cancelled', 'cancelled'],
  awaiting_payment: ['packing', 'cancelled', 'partial_cancelled'],
  awaiting_cod: ['packing', 'cancelled', 'partial_cancelled'],
  packing: ['ready', 'partial_cancelled', 'cancelled'],
  ready: ['handed_to_courier', 'cancelled'],
  handed_to_courier: ['in_transit', 'delivery_failed'],
  in_transit: ['delivered', 'delivery_failed', 'return_requested'],
  delivered: ['return_requested', 'refunded'],
  partial_cancelled: ['awaiting_payment', 'awaiting_cod', 'packing', 'cancelled', 'refunded'],
  cancelled: [],
  delivery_failed: ['return_requested', 'cancelled', 'refunded'],
  return_requested: ['refunded', 'cancelled'],
  refunded: [],
};

export function canTransition(from: ChildStatus, to: ChildStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isBeforeCourierHandoff(status: ChildStatus): boolean {
  return ![
    'handed_to_courier',
    'in_transit',
    'delivered',
    'delivery_failed',
    'return_requested',
    'refunded',
  ].includes(status);
}

export function deriveParentStatus(childStatuses: ChildStatus[]): {
  status: ParentStatus;
  cancellationNote?: string;
} {
  if (childStatuses.length === 0) return { status: 'pending_supplier' };
  if (childStatuses.every((s) => s === 'cancelled')) return { status: 'cancelled' };
  if (childStatuses.every((s) => s === 'delivered')) return { status: 'completed' };

  const hasDelivered = childStatuses.some((s) => s === 'delivered');
  const hasCancelled = childStatuses.some((s) => s === 'cancelled' || s === 'partial_cancelled');
  if (hasDelivered && hasCancelled) {
    return {
      status: 'completed',
      cancellationNote: 'Some store orders were cancelled; remaining deliveries completed.',
    };
  }
  if (childStatuses.some((s) => s === 'pending_supplier' || s === 'partial_confirmed')) {
    return { status: 'partial_confirmed' };
  }
  if (childStatuses.some((s) => s === 'awaiting_payment' || s === 'awaiting_cod')) {
    return { status: 'awaiting_payment' };
  }
  if (hasCancelled) return { status: 'partial_cancelled' };
  return { status: 'in_progress' };
}

export function recalculatePromoDiscount(input: {
  subtotalLak: number;
  percentOff?: number;
  cancelledLineTotalLak: number;
}): { discountLak: number; newSubtotalLak: number; newTotalLak: number } {
  const newSubtotal = input.subtotalLak - input.cancelledLineTotalLak;
  const percent = input.percentOff ?? 0;
  const discountLak = Math.floor((newSubtotal * percent) / 100);
  return {
    discountLak,
    newSubtotalLak: newSubtotal,
    newTotalLak: Math.max(0, newSubtotal - discountLak),
  };
}
