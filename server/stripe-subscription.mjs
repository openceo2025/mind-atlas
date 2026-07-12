export function stripePatchFromStripeSubscription(subscription, customerIdFallback = "", defaultPriceId = "") {
  const item = selectStripeSubscriptionItem(subscription, defaultPriceId);
  return {
    stripeCustomerId: stringValue(subscription?.customer) || stringValue(customerIdFallback),
    stripeSubscriptionId: stringValue(subscription?.id),
    status: stringValue(subscription?.status) || "none",
    priceId: stringValue(item?.price?.id) || stringValue(subscription?.items?.data?.[0]?.price?.id) || defaultPriceId,
    currentPeriodStart: stripeTimestamp(item?.current_period_start) || stripeTimestamp(subscription?.current_period_start),
    currentPeriodEnd: stripeTimestamp(item?.current_period_end) || stripeTimestamp(subscription?.current_period_end),
    cancelAtPeriodEnd: subscription?.cancel_at_period_end === true,
    unitAmountMinor: numberValue(item?.price?.unit_amount) ?? numberValue(subscription?.items?.data?.[0]?.price?.unit_amount),
    currency: stringValue(item?.price?.currency) || stringValue(subscription?.items?.data?.[0]?.price?.currency) || "usd",
    billingInterval: stringValue(item?.price?.recurring?.interval) || stringValue(subscription?.items?.data?.[0]?.price?.recurring?.interval) || "month",
  };
}

export function selectStripeSubscriptionItem(subscription, preferredPriceId = "") {
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  if (!items.length) return null;
  const normalizedPriceId = stringValue(preferredPriceId);
  if (!normalizedPriceId) return items[0] ?? null;
  return items.find((item) => stringValue(item?.price?.id) === normalizedPriceId) ?? items[0] ?? null;
}

export function stripeTimestamp(value) {
  const number = numberValue(value);
  return number ? new Date(number * 1000).toISOString() : null;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
