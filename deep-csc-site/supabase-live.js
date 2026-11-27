(() => {
  const url = window.DEEP_CSC_SUPABASE_URL || '';
  const key = window.DEEP_CSC_SUPABASE_PUBLISHABLE_KEY || '';
  const bucket = 'deep-csc-private-documents';
  const OWNER_EMAILS = new Set(['sandeepharmen@gmail.com']);
  const isOwnerEmail = email => OWNER_EMAILS.has(String(email || '').trim().toLowerCase());
  let session = null;
  let account = null;

  function requireConfig() {
    if (!url || !key) throw new Error('Punjab CSC account service is not configured.');
  }

  function setSession(value) {
    session = value;
    if (!session.expires_at) session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
    const meta = session.user && session.user.user_metadata || {};
    const phoneDigits = String(session.user && session.user.phone || '').replace(/\D/g, '');
    const authMobile = phoneDigits.length === 12 && phoneDigits.startsWith('91') ? phoneDigits.slice(2) : phoneDigits;
    account = session.user ? {
      id: session.user.id,
      name: meta.full_name || 'Punjab CSC customer',
      mobile: /^[6-9][0-9]{9}$/.test(authMobile) ? authMobile : (meta.mobile || ''),
      email: session.user.email || meta.contact_email || '',
      phoneVerified: Boolean(session.user.phone)
    } : null;
  }

  async function getToken() {
    requireConfig();
    if (!session || !session.access_token) throw new Error('Sign in first to save and track your application.');
    if (Number(session.expires_at || 0) * 1000 > Date.now() + 60000) return session.access_token;
    if (!session.refresh_token) {
      session = null;
      account = null;
      throw new Error('Your secure session expired. Please sign in again.');
    }
    const response = await fetch(url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      session = null;
      account = null;
      throw new Error('Your secure session expired. Please sign in again.');
    }
    setSession(data);
    return session.access_token;
  }

  async function request(path, options = {}) {
    requireConfig();
    const method = options.method || 'GET';
    const headers = { apikey: key, ...(options.headers || {}) };
    if (options.auth !== false) headers.Authorization = 'Bearer ' + await getToken();
    let body = options.body;
    if (body instanceof Blob) {
      if (options.contentType) headers['Content-Type'] = options.contentType;
    } else if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
      if (typeof body !== 'string') body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(url + path, { method, headers, body, cache: 'no-store' });
    } catch {
      throw new Error('Punjab CSC secure account service could not be reached.');
    }
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('json')
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error((data && typeof data === 'object' && (data.msg || data.message || data.error_description || data.error)) || 'Secure request failed (' + response.status + ').');
    }
    return data;
  }

  async function ensureProfile() {
    if (!account || !session) throw new Error('Sign in first to continue.');
    // The owner account is authorized by its verified email and aal2 MFA claim;
    // it is not a customer profile and must not be blocked for lacking a mobile field.
    if (isOwnerEmail(account.email)) return;
    if (!/^[6-9][0-9]{9}$/.test(account.mobile)) throw new Error('Your profile needs a WhatsApp mobile number. Register with your name and 10-digit mobile.');
    await request('/rest/v1/customer_profiles?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: {
        user_id: account.id,
        full_name: account.name,
        mobile: account.mobile
      }
    });
  }

  async function auth(mode, payload) {
    requireConfig();
    const isSignup = mode === 'register';
    if (isSignup) {
      if (!payload.email || !payload.name || !payload.mobile) throw new Error('Enter your name, WhatsApp mobile number and email address.');
      if (!/^[6-9][0-9]{9}$/.test(payload.mobile)) throw new Error('Enter a valid 10-digit WhatsApp mobile number.');
    }
    const endpoint = isSignup
      ? '/auth/v1/signup?redirect_to=' + encodeURIComponent('https://deepcsc.dpdns.org/')
      : '/auth/v1/token?grant_type=password';
    const body = isSignup
      ? { email: payload.email, password: payload.password, data: { full_name: payload.name, mobile: payload.mobile } }
      : { email: payload.email, password: payload.password };
    const response = await fetch(url + endpoint, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.msg || data.message || data.error_description || data.error;
      if (String(message).toLowerCase().includes('email not confirmed')) throw new Error('Verify your email with the 6-digit signup code. Return to Sign up to request another code, then sign in.');
      if (data.code === 'invalid_credentials' || String(message).toLowerCase().includes('invalid login credentials')) throw new Error('The email or password does not match. Use “Sign in with email code” if you can access the account inbox.');
      throw new Error(message || (isSignup ? 'Could not create the account. Check the details and try again.' : 'Sign-in failed. Check your verified email and password.'));
    }
    if (!data.access_token) return { status: 'confirm_email' };
    setSession(data);
    await ensureProfile();
    return { status: 'signed_in', account };
  }

  async function requestEmailOtp(email) {
    requireConfig();
    const address = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Enter the email address on your customer account.');
    const response = await fetch(url + '/auth/v1/otp', {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address, create_user: false }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.msg || data.message || data.error_description || data.error;
      if (data.code === 'email_address_not_authorized') throw new Error('Email code delivery is restricted to test addresses. The owner needs to connect a verified email sender before customer codes can be delivered.');
      if (data.code === 'over_email_send_rate_limit') throw new Error(message || 'Please wait before requesting another email code.');
      throw new Error(message || 'Could not send a sign-in code. Try again shortly.');
    }
    return { status: 'otp_sent' };
  }

  function normalizeIndianPhone(value) {
    let digits = String(value || '').replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
    if (!/^[6-9][0-9]{9}$/.test(digits)) throw new Error('Enter a valid 10-digit Indian WhatsApp number.');
    return { mobile: digits, phone: '+91' + digits };
  }

  async function requestWhatsAppOtp(value, options = {}) {
    requireConfig();
    const { mobile, phone } = normalizeIndianPhone(value);
    const createUser = options.createUser === true;
    const name = String(options.name || '').trim();
    const email = String(options.email || '').trim().toLowerCase();
    if (createUser && name.length < 2) throw new Error('Enter your full name to create an account.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address, or leave it blank.');
    const body = { phone, channel: 'whatsapp', create_user: createUser };
    if (createUser) body.data = { full_name: name, mobile, contact_email: email };
    const response = await fetch(url + '/auth/v1/otp', {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.msg || data.message || data.error_description || data.error;
      if (data.code === 'phone_provider_disabled') throw new Error('WhatsApp sign-in is not enabled in Supabase yet. Enable Phone sign-in and configure the Twilio WhatsApp sender first.');
      if (data.code === 'sms_provider_not_configured') throw new Error('Supabase has no phone message provider configured yet. Add the Twilio WhatsApp sender and Content SID in Auth settings.');
      if (data.code === 'over_sms_send_rate_limit' || response.status === 429) throw new Error(message || 'Please wait before requesting another WhatsApp code.');
      throw new Error(message || 'Could not request a WhatsApp code. Check the Twilio WhatsApp setup and try again.');
    }
    return { status: 'otp_sent', mobile };
  }

  async function verifyWhatsAppOtp(value, token) {
    requireConfig();
    const { mobile, phone } = normalizeIndianPhone(value);
    const code = String(token || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the complete 6-digit WhatsApp code.');
    const response = await fetch(url + '/auth/v1/verify', {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, token: code, type: 'sms' }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      const message = data.msg || data.message || data.error_description || data.error;
      throw new Error(message || 'That WhatsApp code could not be verified. Request a new code and try again.');
    }
    setSession(data);
    await ensureProfile();
    return { status: 'signed_in', account };
  }

  async function resendSignupOtp(email) {
    requireConfig();
    const address = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Enter the email address used for registration.');
    const response = await fetch(url + '/auth/v1/resend', {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'signup', email: address }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.msg || data.message || data.error_description || data.error;
      if (data.code === 'over_email_send_rate_limit') throw new Error(message || 'Please wait before requesting another email code.');
      throw new Error(message || 'Could not resend the signup code. Try again shortly.');
    }
    return { status: 'otp_sent' };
  }

  async function requestPasswordRecoveryOtp(email) {
    requireConfig();
    const address = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Enter the email address on your customer account.');
    const response = await fetch(url + '/auth/v1/recover', {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.msg || data.message || data.error_description || data.error;
      if (data.code === 'over_email_send_rate_limit') throw new Error(message || 'Please wait before requesting another reset code.');
      throw new Error(message || 'Could not send a reset code. Try again shortly.');
    }
    return { status: 'otp_sent' };
  }

  async function verifyEmailOtp(email, token, type = 'email') {
    requireConfig();
    const address = String(email || '').trim().toLowerCase();
    const code = String(token || '').replace(/\D/g, '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('Enter the email address on your customer account.');
    if (!/^\d{6}$/.test(code)) throw new Error('Enter the complete 6-digit email code.');
    if (!['email', 'recovery'].includes(type)) throw new Error('Choose a valid email verification purpose.');
    const response = await fetch(url + '/auth/v1/verify', {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: address, token: code, type }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      const message = data.msg || data.message || data.error_description || data.error;
      throw new Error(message || 'That code could not be verified. Request a new code and try again.');
    }
    setSession(data);
    await ensureProfile();
    return { status: 'signed_in', account };
  }

  async function updatePassword(password) {
    requireConfig();
    const nextPassword = String(password || '');
    if (!session || !session.access_token) throw new Error('Verify the password reset code before choosing a new password.');
    if (nextPassword.length < 12 || !/[A-Z]/.test(nextPassword) || !/[a-z]/.test(nextPassword) || !/[0-9]/.test(nextPassword)) {
      throw new Error('Use at least 12 characters with uppercase, lowercase and a number.');
    }
    const response = await fetch(url + '/auth/v1/user', {
      method: 'PUT',
      headers: { apikey: key, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: nextPassword }),
      cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.msg || data.message || data.error_description || data.error;
      throw new Error(message || 'Could not update the password. Request a new reset code and try again.');
    }
    return { status: 'password_updated' };
  }

  async function initialize() {
    requireConfig();
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) return;
    const response = await fetch(url + '/auth/v1/user', {
      headers: { apikey: key, Authorization: 'Bearer ' + accessToken },
      cache: 'no-store'
    });
    const user = await response.json().catch(() => null);
    if (!response.ok || !user || !user.id) return;
    setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Number(params.get('expires_in') || 3600),
      user
    });
    history.replaceState(null, '', window.location.pathname + window.location.search);
    await ensureProfile();
  }

  async function createApplication(input) {
    await ensureProfile();
    const applicantName = String(input.name || '').trim();
    const mobile = String(input.mobile || '').replace(/\D/g, '');
    const service = String(input.service || '').trim();
    const email = String(input.email || '').trim();
    const notes = String(input.notes || '').trim();
    if (!applicantName || applicantName.length > 100) throw new Error('Enter a name up to 100 characters.');
    if (!/^[6-9][0-9]{9}$/.test(mobile)) throw new Error('Enter a valid 10-digit Indian mobile number.');
    if (!service || service.length > 160) throw new Error('Choose a service up to 160 characters.');
    if (email.length > 254) throw new Error('Email address is too long.');
    if (notes.length > 8000) throw new Error('Request details must be 8,000 characters or fewer.');
    const created = await request('/rest/v1/customer_applications', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        owner_id: account.id,
        service,
        applicant_name: applicantName,
        mobile,
        contact_email: input.useAccountEmail === false ? email : (email || account.email || ''),
        notes
      }
    });
    const application = Array.isArray(created) ? created[0] : created;
    if (!application || !application.id) throw new Error('Request could not be saved to your account.');
    let stored = 0;
    let storageError = '';
    if (input.storeFiles) {
      for (const file of input.files || []) {
        let objectPath = '';
        try {
          if (!['image/jpeg', 'image/png', 'application/pdf'].includes(file.type) || file.size < 1 || file.size > 10485760) {
            throw new Error('A file did not meet the JPG, PNG, PDF or 10 MB limit.');
          }
          const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'pdf';
          objectPath = account.id + '/' + application.id + '/' + crypto.randomUUID() + '.' + extension;
          const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
          await request('/storage/v1/object/' + bucket + '/' + encodedPath, {
            method: 'POST',
            body: file,
            contentType: file.type,
            headers: { 'x-upsert': 'false', 'cache-control': '3600' }
          });
          await request('/rest/v1/customer_documents', {
            method: 'POST',
            body: {
              application_id: application.id,
              owner_id: account.id,
              object_path: objectPath,
              original_name: file.name.slice(0, 180),
              media_type: file.type,
              file_size_bytes: file.size
            }
          });
          stored += 1;
        } catch (error) {
          if (objectPath) await request('/storage/v1/object/' + bucket, {
            method: 'DELETE',
            body: { prefixes: [objectPath] }
          }).catch(() => {});
          storageError = error.message;
          break;
        }
      }
    }
    if (input.storeFiles && storageError) {
      await deleteApplication(application.id).catch(() => {});
      throw new Error('The request was not saved because a private file could not be uploaded. Please try again or visit Punjab CSC.');
    }
    return { id: application.id.slice(0, 8).toUpperCase(), requestId: application.id, stored, storageError };
  }

  async function notifyOwnerOfWebsiteRequest(requestId) {
    if (!account) throw new Error('Sign in first to send the owner alert.');
    if (!/^[0-9a-f-]{36}$/i.test(String(requestId || ''))) throw new Error('Request reference is not valid.');
    const response = await fetch(url + '/functions/v1/notify-new-website-activity', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + await getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId }),
      cache: 'no-store'
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 503 && result.reason === 'not_configured') return { sent: false, reason: 'not_configured' };
    if (!response.ok) throw new Error(result.error || 'The website request was saved, but the generic owner alert could not be sent.');
    return result;
  }

  async function listApplications() {
    if (!account) throw new Error('Sign in first to view your requests.');
    return request('/rest/v1/customer_applications?select=id,service,status,created_at,customer_documents(id,original_name,object_path)&owner_id=eq.' + encodeURIComponent(account.id) + '&order=created_at.desc');
  }

  async function deleteApplicationFiles(applicationId, paths) {
    if (!Array.isArray(paths) || !paths.length) return;
    await request('/storage/v1/object/' + bucket, { method: 'DELETE', body: { prefixes: paths } });
    await request('/rest/v1/customer_documents?application_id=eq.' + encodeURIComponent(applicationId), { method: 'DELETE' });
  }

  async function deleteApplication(applicationId) {
    const id = String(applicationId || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Application reference is not valid.');
    const rows = await request('/rest/v1/customer_documents?select=object_path&application_id=eq.' + encodeURIComponent(id));
    const paths = (rows || []).map((row) => row.object_path).filter(Boolean);
    if (paths.length) await request('/storage/v1/object/' + bucket, { method: 'DELETE', body: { prefixes: paths } });
    await request('/rest/v1/customer_applications?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
  }

  function tokenClaims() {
    try {
      const part = session && session.access_token.split('.')[1];
      if (!part) return {};
      const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
    } catch { return {}; }
  }

  async function listFactors() {
    // Supabase lists a user's MFA factors on GET /auth/v1/user. The
    // /auth/v1/factors route is enrollment-only (POST), so GET returns 405.
    const user = await request('/auth/v1/user');
    const grouped = { all: [], phone: [], totp: [], webauthn: [], recovery_code: [] };
    for (const factor of Array.isArray(user && user.factors) ? user.factors : []) {
      grouped.all.push(factor);
      if (Object.prototype.hasOwnProperty.call(grouped, factor.factor_type)) {
        grouped[factor.factor_type].push(factor);
      }
    }
    return grouped;
  }

  async function enrollAuthenticator() {
    return request('/auth/v1/factors', {
      method: 'POST',
      body: { factor_type: 'totp', friendly_name: 'Punjab CSC owner authenticator' }
    });
  }

  async function challengeAuthenticator(factorId) {
    return request('/auth/v1/factors/' + encodeURIComponent(factorId) + '/challenge', {
      method: 'POST', body: {}
    });
  }

  async function verifyAuthenticator(factorId, challengeId, code) {
    const result = await request('/auth/v1/factors/' + encodeURIComponent(factorId) + '/verify', {
      method: 'POST',
      body: { challenge_id: challengeId, code: String(code).replace(/\D/g, '') }
    });
    if (result && result.access_token) setSession(result);
    return result;
  }

  async function removeAuthenticator(factorId) {
    return request('/auth/v1/factors/' + encodeURIComponent(factorId), { method: 'DELETE' });
  }

  async function listOwnerApplications() {
    if (!account || !isOwnerEmail(account.email) || tokenClaims().aal !== 'aal2') {
      throw new Error('Owner applications require the Punjab CSC owner account and Google Authenticator verification.');
    }
    return request('/rest/v1/customer_applications?select=id,service,applicant_name,mobile,contact_email,notes,status,created_at,customer_documents(id,original_name,object_path,media_type,file_size_bytes)&order=created_at.desc');
  }

  async function listPublicOffers() {
    const now = encodeURIComponent(new Date().toISOString());
    return request('/rest/v1/site_offers?select=id,title,message,button_label,starts_at,ends_at&active=eq.true&starts_at=lte.' + now + '&ends_at=gt.' + now + '&order=starts_at.desc&limit=1', { auth: false });
  }

  async function listOwnerCustomersSince(isoTime) {
    requireOwnerAal2();
    return request('/rest/v1/customer_profiles?select=created_at&created_at=gte.' + encodeURIComponent(isoTime));
  }

  async function listOwnerOffers() {
    requireOwnerAal2();
    return request('/rest/v1/site_offers?select=id,title,message,button_label,starts_at,ends_at,active,created_at&order=starts_at.desc');
  }

  async function saveOwnerOffer(offer) {
    requireOwnerAal2();
    const values = {
      title: String(offer.title || '').trim(),
      message: String(offer.message || '').trim(),
      button_label: String(offer.buttonLabel || 'Ask on WhatsApp').trim(),
      starts_at: offer.startsAt,
      ends_at: offer.endsAt,
      active: Boolean(offer.active)
    };
    if (!values.title || values.title.length > 100 || !values.message || values.message.length > 280 || values.button_label.length > 36 || !(Date.parse(values.starts_at) < Date.parse(values.ends_at))) {
      throw new Error('Check the offer title, 280-character message, and start/end times.');
    }
    return request('/rest/v1/site_offers', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { ...values, created_by: account.id }
    });
  }

  async function updateOwnerOffer(offerId, active) {
    requireOwnerAal2();
    if (!/^[0-9a-f-]{36}$/i.test(String(offerId || ''))) throw new Error('Offer reference is not valid.');
    return request('/rest/v1/site_offers?id=eq.' + encodeURIComponent(offerId), {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { active: Boolean(active) }
    });
  }

  async function deleteOwnerOffer(offerId) {
    requireOwnerAal2();
    if (!/^[0-9a-f-]{36}$/i.test(String(offerId || ''))) throw new Error('Offer reference is not valid.');
    return request('/rest/v1/site_offers?id=eq.' + encodeURIComponent(offerId), { method: 'DELETE' });
  }

  async function listOwnerRefunds() {
    requireOwnerAal2();
    return request('/rest/v1/manual_refunds?select=id,application_id,amount_paise,method,status,reason,payment_reference,owner_notes,created_at,customer_applications(applicant_name,mobile,service)&order=created_at.desc');
  }

  async function createOwnerRefund(input) {
    requireOwnerAal2();
    const amountPaise = Math.round(Number(input.amountRupees) * 100);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 1 || amountPaise > 1000000000) throw new Error('Enter a valid refund amount in rupees.');
    const method = String(input.method || '');
    if (!['upi', 'cash', 'bank_transfer', 'other'].includes(method)) throw new Error('Choose a refund method.');
    const reason = String(input.reason || '').trim();
    if (!reason || reason.length > 500) throw new Error('Add a short refund reason (up to 500 characters).');
    const applicationId = String(input.applicationId || '');
    if (applicationId && !/^[0-9a-f-]{36}$/i.test(applicationId)) throw new Error('Application reference is not valid.');
    const row = {
      application_id: applicationId || null,
      amount_paise: amountPaise,
      method,
      reason,
      payment_reference: String(input.paymentReference || '').trim().slice(0, 160) || null,
      owner_notes: String(input.ownerNotes || '').trim().slice(0, 1000),
      created_by: account.id
    };
    return request('/rest/v1/manual_refunds', { method: 'POST', headers: { Prefer: 'return=representation' }, body: row });
  }

  async function updateOwnerRefundStatus(refundId, status) {
    requireOwnerAal2();
    if (!/^[0-9a-f-]{36}$/i.test(String(refundId || ''))) throw new Error('Refund reference is not valid.');
    if (!['pending', 'approved', 'processed', 'declined'].includes(status)) throw new Error('Choose a valid refund status.');
    return request('/rest/v1/manual_refunds?id=eq.' + encodeURIComponent(refundId), {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { status, updated_at: new Date().toISOString() }
    });
  }

  async function listOwnerActivity() {
    requireOwnerAal2();
    return request('/rest/v1/customer_activity?select=id,event_type,application_id,offer_id,refund_id,details,created_at&order=created_at.desc&limit=50');
  }

  function ownerRecords(table, select, order = 'created_at.desc') {
    requireOwnerAal2();
    return request('/rest/v1/' + table + '?select=' + encodeURIComponent(select) + '&owner_id=eq.' + encodeURIComponent(account.id) + '&order=' + encodeURIComponent(order));
  }

  async function getOwnerSettings() {
    requireOwnerAal2();
    const rows = await request('/rest/v1/owner_center_settings?select=settings&owner_id=eq.' + encodeURIComponent(account.id) + '&limit=1');
    return rows[0]?.settings && typeof rows[0].settings === 'object' ? rows[0].settings : null;
  }

  async function saveOwnerSettings(settings) {
    requireOwnerAal2();
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Settings are not valid.');
    const serialized = JSON.stringify(settings);
    if (serialized.length > 700000) throw new Error('The saved settings are too large. Reduce the QR image before saving.');
    await request('/rest/v1/owner_center_settings?on_conflict=owner_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { owner_id: account.id, settings, updated_at: new Date().toISOString() }
    });
    return settings;
  }

  async function listOwnerPayments() {
    return ownerRecords('owner_payment_records', 'id,application_id,service_name,government_fee_paise,service_charge_paise,total_amount_paise,status,method,payment_reference,notes,created_at,paid_at,customer_applications(applicant_name,mobile)', 'created_at.desc');
  }

  async function createOwnerPayment(input) {
    requireOwnerAal2();
    const toPaise = (value, label) => {
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) throw new Error(label + ' must be a valid rupee amount.');
      return Math.round(amount * 100);
    };
    const service = String(input.serviceName || '').trim();
    if (!service || service.length > 180) throw new Error('Choose the service for this payment record.');
    const applicationId = String(input.applicationId || '');
    if (applicationId && !/^[0-9a-f-]{36}$/i.test(applicationId)) throw new Error('Application reference is not valid.');
    const body = {
      owner_id: account.id,
      application_id: applicationId || null,
      service_name: service,
      government_fee_paise: toPaise(input.governmentFeeRupees || 0, 'Government fee'),
      service_charge_paise: toPaise(input.serviceChargeRupees || 0, 'Service charge'),
      notes: String(input.notes || '').trim().slice(0, 500)
    };
    if (body.government_fee_paise + body.service_charge_paise <= 0) throw new Error('Enter a government fee or service charge above zero.');
    return request('/rest/v1/owner_payment_records', { method: 'POST', headers: { Prefer: 'return=representation' }, body });
  }

  async function updateOwnerPayment(id, status, method, paymentReference) {
    requireOwnerAal2();
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new Error('Payment record reference is not valid.');
    if (!['due', 'paid', 'cancelled'].includes(status)) throw new Error('Choose a valid payment status.');
    if (status === 'paid' && !['upi', 'cash', 'bank_transfer', 'card', 'other'].includes(method)) throw new Error('Choose how the payment was received.');
    return request('/rest/v1/owner_payment_records?id=eq.' + encodeURIComponent(id) + '&owner_id=eq.' + encodeURIComponent(account.id), {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: { status, method: status === 'paid' ? method : null, payment_reference: String(paymentReference || '').trim().slice(0, 160) || null, paid_at: status === 'paid' ? new Date().toISOString() : null }
    });
  }

  async function listOwnerExpenses() {
    return ownerRecords('owner_business_expenses', 'id,category,amount_paise,spent_on,notes,created_at', 'spent_on.desc');
  }

  async function createOwnerExpense(input) {
    requireOwnerAal2();
    const category = String(input.category || '').trim();
    const amount = Math.round(Number(input.amountRupees) * 100);
    if (!category || category.length > 80) throw new Error('Choose an expense category (up to 80 characters).');
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000000) throw new Error('Enter a valid expense amount.');
    const spentOn = String(input.spentOn || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) throw new Error('Choose the expense date.');
    return request('/rest/v1/owner_business_expenses', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { owner_id: account.id, category, amount_paise: amount, spent_on: spentOn, notes: String(input.notes || '').trim().slice(0, 500) } });
  }

  async function deleteOwnerExpense(id) {
    requireOwnerAal2();
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new Error('Expense reference is not valid.');
    return request('/rest/v1/owner_business_expenses?id=eq.' + encodeURIComponent(id) + '&owner_id=eq.' + encodeURIComponent(account.id), { method: 'DELETE' });
  }

  async function listOwnerInventory() {
    return ownerRecords('owner_inventory_items', 'id,item_name,quantity,unit,low_stock_at,unit_cost_paise,updated_at', 'item_name.asc');
  }

  async function saveOwnerInventoryItem(input) {
    requireOwnerAal2();
    const itemName = String(input.itemName || '').trim();
    const quantity = Number(input.quantity), threshold = Number(input.lowStockAt);
    const cost = input.unitCostRupees === '' || input.unitCostRupees === undefined ? null : Math.round(Number(input.unitCostRupees) * 100);
    if (!itemName || itemName.length > 120) throw new Error('Enter an item name (up to 120 characters).');
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1000000000 || !Number.isFinite(threshold) || threshold < 0 || threshold > 1000000000) throw new Error('Enter a valid stock quantity and low-stock threshold.');
    if (cost !== null && (!Number.isSafeInteger(cost) || cost < 0 || cost > 100000000000)) throw new Error('Enter a valid item cost.');
    return request('/rest/v1/owner_inventory_items?on_conflict=owner_id,item_name', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: { owner_id: account.id, item_name: itemName, quantity, unit: String(input.unit || 'pieces').trim().slice(0, 24) || 'pieces', low_stock_at: threshold, unit_cost_paise: cost, updated_at: new Date().toISOString() }
    });
  }

  async function deleteOwnerInventoryItem(id) {
    requireOwnerAal2();
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new Error('Inventory record reference is not valid.');
    return request('/rest/v1/owner_inventory_items?id=eq.' + encodeURIComponent(id) + '&owner_id=eq.' + encodeURIComponent(account.id), { method: 'DELETE' });
  }

  async function listOwnerReminders() {
    return ownerRecords('owner_reminders', 'id,reminder_type,title,due_on,official_url,notes,completed,created_at', 'due_on.asc');
  }

  async function createOwnerReminder(input) {
    requireOwnerAal2();
    const title = String(input.title || '').trim(), dueOn = String(input.dueOn || '');
    const reminderType = String(input.reminderType || 'other');
    if (!title || title.length > 160) throw new Error('Enter a reminder title (up to 160 characters).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) throw new Error('Choose the reminder date.');
    if (!['job','scholarship','tax','insurance','puc','licence','followup','other'].includes(reminderType)) throw new Error('Choose a valid reminder type.');
    const officialUrl = String(input.officialUrl || '').trim();
    if (officialUrl && (!officialUrl.startsWith('https://') || officialUrl.length > 2048)) throw new Error('Use a valid HTTPS official link.');
    return request('/rest/v1/owner_reminders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { owner_id: account.id, reminder_type: reminderType, title, due_on: dueOn, official_url: officialUrl, notes: String(input.notes || '').trim().slice(0, 600) } });
  }

  async function updateOwnerReminder(id, completed) {
    requireOwnerAal2();
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new Error('Reminder reference is not valid.');
    return request('/rest/v1/owner_reminders?id=eq.' + encodeURIComponent(id) + '&owner_id=eq.' + encodeURIComponent(account.id), { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { completed: Boolean(completed), updated_at: new Date().toISOString() } });
  }

  async function deleteOwnerReminder(id) {
    requireOwnerAal2();
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new Error('Reminder reference is not valid.');
    return request('/rest/v1/owner_reminders?id=eq.' + encodeURIComponent(id) + '&owner_id=eq.' + encodeURIComponent(account.id), { method: 'DELETE' });
  }

  async function listOwnerPcSessions() {
    return ownerRecords('owner_pc_sessions', 'id,computer_label,hourly_rate_paise,started_at,ended_at,total_amount_paise,status,created_at', 'started_at.desc');
  }

  async function startOwnerPcSession(input) {
    requireOwnerAal2();
    const label = String(input.computerLabel || '').trim();
    const rate = Math.round(Number(input.hourlyRateRupees || 0) * 100);
    if (!label || label.length > 40) throw new Error('Enter a computer label (up to 40 characters).');
    if (!Number.isSafeInteger(rate) || rate < 0 || rate > 10000000000) throw new Error('Enter a valid hourly rate.');
    return request('/rest/v1/owner_pc_sessions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { owner_id: account.id, computer_label: label, hourly_rate_paise: rate } });
  }

  async function endOwnerPcSession(id, status = 'ended') {
    requireOwnerAal2();
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new Error('Computer session reference is not valid.');
    if (!['ended', 'cancelled'].includes(status)) throw new Error('Choose a valid computer session status.');
    const now = new Date();
    const sessions = await request('/rest/v1/owner_pc_sessions?select=id,started_at,hourly_rate_paise&id=eq.' + encodeURIComponent(id) + '&owner_id=eq.' + encodeURIComponent(account.id) + '&status=eq.running&limit=1');
    const sessionRow = sessions[0];
    if (!sessionRow) throw new Error('This session is already closed or unavailable. Refresh the dashboard.');
    const seconds = Math.max(0, (now.getTime() - Date.parse(sessionRow.started_at)) / 1000);
    const amount = status === 'ended' ? Math.ceil(seconds * Number(sessionRow.hourly_rate_paise || 0) / 3600) : 0;
    return request('/rest/v1/owner_pc_sessions?id=eq.' + encodeURIComponent(id) + '&owner_id=eq.' + encodeURIComponent(account.id) + '&status=eq.running', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { ended_at: now.toISOString(), status, total_amount_paise: amount } });
  }

  async function listOwnerDashboardActivity() {
    requireOwnerAal2();
    return request('/rest/v1/owner_dashboard_activity?select=id,event_type,entity_id,details,created_at&owner_id=eq.' + encodeURIComponent(account.id) + '&order=created_at.desc&limit=50');
  }

  async function recordOwnerDashboardActivity(eventType, entityId, details = {}) {
    requireOwnerAal2();
    const type = String(eventType || '').trim();
    if (!type || type.length > 80) return;
    await request('/rest/v1/owner_dashboard_activity', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { owner_id: account.id, actor_id: account.id, event_type: type, entity_id: /^[0-9a-f-]{36}$/i.test(String(entityId || '')) ? entityId : null, details: details && typeof details === 'object' && !Array.isArray(details) ? details : {} } });
  }

  function requireOwnerAal2() {
    if (!account || !isOwnerEmail(account.email) || tokenClaims().aal !== 'aal2') {
      throw new Error('Owner dashboard data requires the Punjab CSC owner account and Google Authenticator verification.');
    }
  }

  async function updateApplicationStatus(applicationId, status) {
    if (!['new', 'in_review', 'waiting_customer', 'completed', 'cancelled'].includes(status)) throw new Error('Choose a valid application status.');
    return request('/rest/v1/customer_applications?id=eq.' + encodeURIComponent(applicationId), {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: { status }
    });
  }

  async function createOwnerDocumentLink(objectPath) {
    const path = String(objectPath || '').split('/').map(encodeURIComponent).join('/');
    if (!path || !account || !isOwnerEmail(account.email) || tokenClaims().aal !== 'aal2') {
      throw new Error('Owner file access requires Google Authenticator verification.');
    }
    const result = await request('/storage/v1/object/sign/' + bucket + '/' + path, {
      method: 'POST', body: { expiresIn: 60 }
    });
    if (!result.signedURL) throw new Error('Could not create a private document link.');
    return result.signedURL.startsWith('http') ? result.signedURL : url + result.signedURL;
  }

  async function signOut() {
    if (session && session.access_token) {
      await fetch(url + '/auth/v1/logout', {
        method: 'POST',
        headers: { apikey: key, Authorization: 'Bearer ' + session.access_token },
        cache: 'no-store'
      }).catch(() => {});
    }
    session = null;
    account = null;
  }

  window.DeepCSCBackend = Object.freeze({
    auth,
    requestEmailOtp,
    requestWhatsAppOtp,
    verifyWhatsAppOtp,
    resendSignupOtp,
    requestPasswordRecoveryOtp,
    verifyEmailOtp,
    updatePassword,
    initialize,
    getAccount: () => account,
    createApplication,
    notifyOwnerOfWebsiteRequest,
    listApplications,
    deleteApplicationFiles,
    deleteApplication,
    listFactors,
    enrollAuthenticator,
    challengeAuthenticator,
    verifyAuthenticator,
    removeAuthenticator,
    getAssuranceLevel: () => tokenClaims().aal || 'aal1',
    listOwnerApplications,
    listPublicOffers,
    listOwnerCustomersSince,
    listOwnerOffers,
    saveOwnerOffer,
    updateOwnerOffer,
    deleteOwnerOffer,
    listOwnerRefunds,
    createOwnerRefund,
    updateOwnerRefundStatus,
    listOwnerActivity,
    getOwnerSettings,
    saveOwnerSettings,
    listOwnerPayments,
    createOwnerPayment,
    updateOwnerPayment,
    listOwnerExpenses,
    createOwnerExpense,
    deleteOwnerExpense,
    listOwnerInventory,
    saveOwnerInventoryItem,
    deleteOwnerInventoryItem,
    listOwnerReminders,
    createOwnerReminder,
    updateOwnerReminder,
    deleteOwnerReminder,
    listOwnerPcSessions,
    startOwnerPcSession,
    endOwnerPcSession,
    listOwnerDashboardActivity,
    recordOwnerDashboardActivity,
    updateApplicationStatus,
    createOwnerDocumentLink,
    signOut
  });
})();
