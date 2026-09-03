# Courier and Bank Manual Fallback Runbooks

## When to use
Provider API down, sandbox mismatch, or Owner has not issued live credentials.

## Courier fallback
1. Mark shipment `manual_handoff` in fulfillment notes
2. Ops prints packing slip from Backoffice
3. Record courier name, tracking ID, and POD photo manually
4. Update child order timeline events by hand (audit logged)
5. Resume adapter sync when provider recovers — do not double-create labels

## Bank / QR remittance fallback
1. Pause automated reconcile job
2. Ops imports bank statement CSV / screenshot into reconcile inbox
3. Match by amount (integer LAK) + transfer reference + time window
4. Unmatched rows stay `pending_manual` — never auto-allocate
5. COD remains available within configured limits when QR is impaired

## Exit criteria
- Adapter health green for 24h **or** Owner accepts continued manual mode in risk log
