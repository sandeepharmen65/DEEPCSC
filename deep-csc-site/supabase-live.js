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
    account = session.user ? {
      id: session.user.id,
      name: meta.full_name || 'Punjab CSC customer',
      mobile: meta.mobile || '',
      email: session.user.email || ''
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
    const created = await request('/rest/v1/customer_applications', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        owner_id: account.id,
        service: input.service,
        applicant_name: input.name,
        mobile: input.mobile,
        contact_email: input.useAccountEmail === false ? (input.email || '') : (input.email || account.email || ''),
        notes: input.notes || ''
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
    return { id: application.id.slice(0, 8).toUpperCase(), stored, storageError };
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
    resendSignupOtp,
    requestPasswordRecoveryOtp,
    verifyEmailOtp,
    updatePassword,
    initialize,
    getAccount: () => account,
    createApplication,
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
    updateApplicationStatus,
    createOwnerDocumentLink,
    signOut
  });
})();
