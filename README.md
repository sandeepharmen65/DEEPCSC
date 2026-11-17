# Deep CSC

Responsive service website for Deep CSC, Chhajli, Sunam, Punjab.

## Live features

- A–Z service directory and service-specific document checklists.
- Customer email registration and sign-in through Supabase Auth.
- Customer requests saved to the signed-in customer's account after consent.
- Optional JPG, PNG, or PDF private-copy storage (10 MB maximum). Selecting a file alone does not upload it.
- Native device share flow so a customer chooses WhatsApp or another target to send the actual attachment.
- Customer request list and delete-request action.
- Private owner queue for deepcsc06@gmail.com; customer data and document access require a verified TOTP authenticator session (aal2).
- Owner dashboard includes customer/request counts, CSV export, date-scheduled public offer banners, manual refund-status records, and an owner-only activity log.
- Signed document links expire after 60 seconds. The storage bucket is private.
- Online checkout, SMS OTP, automated government submissions, and payment reporting are not active.

## Website files

- deep-csc-site/index.html — customer website.
- deep-csc-site/app.js — service forms, account and owner interfaces.
- deep-csc-site/supabase-live.js — browser API integration; holds login tokens in memory only.
- deep-csc-site/runtime-config.js — public Supabase project URL and publishable key. Publishable keys are intended for browser apps and are protected by database policies; never put a service-role key or payment secret here.
- deep-csc-site/styles.css — responsive design and owner dashboard.
- deep-csc-site/legal.html — privacy, terms, cookie, refund, and DPDP notices.
- supabase/migrations/ — database migration source.

## Hosting and database

Vercel serves the static deep-csc-site directory. The website uses the Supabase project in ap-southeast-1 for customer authentication, row-level-secured requests, and the private document bucket.

Before customers register, in Supabase Dashboard open Authentication → URL Configuration:

1. Set Site URL to https://deepcsc.dpdns.org.
2. Add https://deepcsc.dpdns.org/ to Redirect URLs.
3. Save the settings.

Keep email confirmation enabled. The owner dashboard is available only after signing in with the verified business email and enrolling/verifying a TOTP authenticator in the owner screen. Customer accounts use verified email and password; phone/SMS OTP is not configured.

Deploy website changes by pushing to the GitHub branch connected to Vercel. The six SQL migrations applied to the live database are kept in `supabase/migrations/`; review them before using this setup on another project. Refund entries are internal manual notes only, and online checkout/revenue automation remains disabled until a server-side payment gateway is configured.

## Payment status

The website deliberately disables online checkout. To enable Razorpay later, implement and deploy a server-side order/verification endpoint, configure live merchant keys in server secrets, set and verify webhook signatures, then update the customer flow and legal notice. Do not expose payment secrets in browser JavaScript, Git, or chat.

## Data handling

The database uses RLS to restrict customer records to their owner. The owner email can review all customer records only with aal2; the policy is enforced in Postgres and Storage. Customer deletion removes the request and private object copies, but cannot remove content already sent to WhatsApp or another provider.
