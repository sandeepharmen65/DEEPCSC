(() => {
  const url = window.DEEP_CSC_SUPABASE_URL || '';
  const key = window.DEEP_CSC_SUPABASE_PUBLISHABLE_KEY || '';
  const bucket = 'deep-csc-private-documents';
  let session = null;
  let account = null;

  function requireConfig() {
    if (!url || !key) throw new Error('Deep CSC account service is not configured.');
  }

  function setSession(value) {
    session = value;
    if (!session.expires_at) session.expires_at = Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
    const meta = session.user && session.user.user_metadata || {};
    account = session.user ? {
      id: session.user.id,
      name: meta.full_name || 'Deep CSC customer',
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
      throw new Error('Deep CSC secure account service could not be reached.');
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
      if (String(message).toLowerCase().includes('email not confirmed')) throw new Error('Confirm your email using the link we sent, then sign in.');
      throw new Error(message || (isSignup ? 'Could not create the account. Check the details and try again.' : 'Sign-in failed. Check your verified email and password.'));
    }
    if (!data.access_token) return { status: 'confirm_email' };
    setSession(data);
    await ensureProfile();
    return { status: 'signed_in', account };
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
        contact_email: input.email || account.email || '',
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
    return request('/auth/v1/factors');
  }

  async function enrollAuthenticator() {
    return request('/auth/v1/factors', {
      method: 'POST',
      body: { factor_type: 'totp', friendly_name: 'Deep CSC owner authenticator' }
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
    if (!account || account.email.toLowerCase() !== 'deepcsc06@gmail.com' || tokenClaims().aal !== 'aal2') {
      throw new Error('Owner applications require the Deep CSC owner account and Google Authenticator verification.');
    }
    return request('/rest/v1/customer_applications?select=id,service,applicant_name,mobile,contact_email,notes,status,created_at,customer_documents(id,original_name,object_path,media_type,file_size_bytes)&order=created_at.desc');
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
    if (!path || !account || account.email.toLowerCase() !== 'deepcsc06@gmail.com' || tokenClaims().aal !== 'aal2') {
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
    updateApplicationStatus,
    createOwnerDocumentLink,
    signOut
  });
})();
