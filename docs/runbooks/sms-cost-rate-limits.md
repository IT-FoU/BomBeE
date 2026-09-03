# SMS Cost, Rate Limit, and Abuse Protection

## Phase 1 stance
- Local: **mock SMS only**
- Staging: **sandbox / provider test credentials** until Owner supplies live SMS credentials in writing
- Production live SMS: blocked by `INTEGRATIONS_MODE` until Owner approval

## Controls
| Control | Target |
| --- | --- |
| OTP send rate | ≤ 3 / phone / 10 min; ≤ 10 / IP / 10 min |
| Daily Staging SMS budget | Document in secret store; alert at 80% |
| Mock OTP codes | Never valid outside Local |
| Content | Transactional OTP / order notices only — no marketing blasts in Private Beta |

## Abuse responses
1. Trip rate limiter → `429` + audit event
2. Suspected credential stuffing → lock identity after 5 failed OTP verifies (existing policy)
3. Cost spike → disable SMS channel switch to in-app notices; notify Owner

## Verification
- Capabilities endpoint reports `smsProvider: mock|sandbox` (not external live) until approved
- Unit/integration suites never call a paid SMS API
