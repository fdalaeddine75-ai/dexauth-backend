let adminToken = '';
let currentTab = 'dashboard';
let keysData = [];
let usersData = [];
let appsData = [];
let currentAppId = null;

// ═══════════════════════════════════════════════════════════════════════════════
// TOAST NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
function toast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const colors = {
    success: { border: '#22d3ee', glow: 'rgba(34,211,238,0.25)', icon: '✅', text: '#67e8f9', badge: 'bg-cyan-900/60' },
    error:   { border: '#f87171', glow: 'rgba(248,113,113,0.25)', icon: '❌', text: '#fca5a5', badge: 'bg-red-900/60' },
    warning: { border: '#fbbf24', glow: 'rgba(251,191,36,0.25)',  icon: '⚠️', text: '#fde68a', badge: 'bg-yellow-900/60' },
    info:    { border: '#a78bfa', glow: 'rgba(167,139,250,0.25)', icon: 'ℹ️', text: '#c4b5fd', badge: 'bg-purple-900/60' },
  };
  const c = colors[type] || colors.info;

  const el = document.createElement('div');
  el.className = 'pointer-events-auto';
  el.style.cssText = `
    display:flex; align-items:flex-start; gap:12px;
    background:#0C0E14; border:1px solid ${c.border};
    border-radius:8px; padding:14px 16px; min-width:280px; max-width:380px;
    box-shadow: 0 0 24px ${c.glow}, 0 4px 20px rgba(0,0,0,0.5);
    animation: slideInToast 0.3s ease; position:relative; overflow:hidden;
  `;

  el.innerHTML = `
    <div style="font-size:18px;line-height:1;margin-top:1px">${c.icon}</div>
    <div style="flex:1">
      <p style="color:${c.text};font-size:13px;font-weight:600;font-family:'Outfit',sans-serif;line-height:1.5">${message}</p>
    </div>
    <button onclick="this.parentElement.remove()" style="color:#475569;font-size:16px;line-height:1;background:none;border:none;cursor:pointer;margin-top:1px">✕</button>
    <div style="position:absolute;bottom:0;left:0;height:2px;background:${c.border};animation:toastProgress ${duration}ms linear forwards"></div>
  `;

  // Add keyframe animations if not already present
  if (!document.getElementById('toast-styles')) {
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
      @keyframes slideInToast { from { opacity:0; transform:translateX(40px); } to { opacity:1; transform:translateX(0); } }
      @keyframes slideOutToast { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(40px); } }
      @keyframes toastProgress { from { width:100%; } to { width:0%; } }
    `;
    document.head.appendChild(style);
  }

  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slideOutToast 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, duration);
}


// Programmatic Google Sign-In Initialization with robust race condition and error handling
async function initGoogleSignIn() {
  const btnContainer = document.getElementById('g-signin-button');
  if (!btnContainer) return;

  // Check if Google script was blocked by browser shields or extensions
  if (typeof window.google === 'undefined' || !window.google.accounts) {
    btnContainer.innerHTML = `
      <div class="p-4 bg-red-950/40 border border-red-500/20 text-red-400 rounded text-center text-xs w-full max-w-sm">
        <p class="font-bold uppercase tracking-wider mb-1">Library Blocked</p>
        <p class="text-slate-400">Google accounts library failed to load. Please disable ad-blockers or privacy extensions blocking <strong>accounts.google.com</strong>.</p>
      </div>
    `;
    return;
  }

  try {
    const configRes = await fetch('/api/admin/google-client-id-config');
    if (configRes.ok) {
      const config = await configRes.json();

      if (config.googleClientId && config.googleClientId !== 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com') {
        window.google.accounts.id.initialize({
          client_id: config.googleClientId,
          callback: handleCredentialResponse,
          context: 'signin',
          ux_mode: 'popup'
        });

        window.google.accounts.id.renderButton(
          btnContainer,
          {
            type: 'standard',
            shape: 'rectangular',
            theme: 'filled_dark',
            text: 'signin_with',
            size: 'large',
            logo_alignment: 'left'
          }
        );
      } else {
        // Render detailed configuration instructions if the Client ID is empty or placeholder
        btnContainer.innerHTML = `
          <div class="p-4 bg-yellow-950/40 border border-yellow-500/20 text-yellow-400 rounded text-center text-xs w-full max-w-sm">
            <p class="font-bold uppercase tracking-wider mb-1">Configuration Required</p>
            <p class="text-slate-400 mb-2">Please configure your Google Client ID to enable administration login.</p>
            <div class="bg-[#121620] p-2 rounded text-left text-slate-300 font-mono text-[10px] select-all mb-2">
              GOOGLE_CLIENT_ID=your_id.apps.googleusercontent.com
            </div>
            <p class="text-slate-500 text-[10px]">Create a <strong>.env</strong> file in the backend directory with this value and restart your server.</p>
          </div>
        `;
      }
    } else {
      btnContainer.innerHTML = `
        <div class="p-4 bg-red-950/40 border border-red-500/20 text-red-400 rounded text-center text-xs w-full max-w-sm">
          <p class="font-bold uppercase tracking-wider mb-1">Server Error</p>
          <p class="text-slate-400">Configuration endpoint returned status ${configRes.status}.</p>
        </div>
      `;
    }
  } catch (err) {
    console.error('Failed to resolve Google Client ID config:', err);
    btnContainer.innerHTML = `
      <div class="p-4 bg-red-950/40 border border-red-500/20 text-red-400 rounded text-center text-xs w-full max-w-sm">
        <p class="font-bold uppercase tracking-wider mb-1">Connection Error</p>
        <p class="text-slate-400 mb-2">Failed to reach the backend API server.</p>
        <p class="text-slate-500 text-[10px]">Ensure the backend is running and you are accessing this dashboard via the server URL, not by opening the file directly.</p>
      </div>
    `;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();

  // Handle case where google Identity script loads asynchronously
  if (typeof window.google !== 'undefined' && window.google.accounts) {
    initGoogleSignIn();
  } else {
    // Fallback if script executes after DOMContentLoaded
    window.addEventListener('load', initGoogleSignIn);
  }

  // Check for saved session token
  const savedToken = localStorage.getItem('dexauth_admin_token');
  if (savedToken) {
    adminToken = savedToken;
    verifyTokenAndLogin(savedToken);
  }
});

// Google Identity Credential callback
async function handleCredentialResponse(response) {
  const idToken = response.credential;
  
  try {
    const res = await fetch('/api/admin/auth/google', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ idToken })
    });

    if (res.ok) {
      const data = await res.json();
      adminToken = data.sessionToken;
      localStorage.setItem('dexauth_admin_token', adminToken);
      document.getElementById('login-container').classList.add('hidden');
      document.getElementById('app-container').classList.remove('hidden');
      document.getElementById('login-error').classList.add('hidden');
      loadTab(currentTab);
    } else {
      showLoginError();
    }
  } catch (error) {
    showLoginError();
  }
}

async function verifyTokenAndLogin(token) {
  try {
    const res = await fetch(`/api/admin/stats`, {
      headers: { 'x-admin-token': token }
    });

    if (res.ok) {
      adminToken = token;
      localStorage.setItem('dexauth_admin_token', token);
      document.getElementById('login-container').classList.add('hidden');
      document.getElementById('app-container').classList.remove('hidden');
      document.getElementById('login-error').classList.add('hidden');
      loadTab(currentTab);
    } else {
      showLoginError();
    }
  } catch (error) {
    showLoginError();
  }
}

function showLoginError() {
  document.getElementById('login-error').classList.remove('hidden');
  localStorage.removeItem('dexauth_admin_token');
}

function logoutAdmin() {
  localStorage.removeItem('dexauth_admin_token');
  adminToken = '';
  document.getElementById('login-container').classList.remove('hidden');
  document.getElementById('app-container').classList.add('hidden');
}

// Tab Switching
function switchTab(tabName) {
  currentTab = tabName;
  
  // Update Navigation Active States
  const navIds = ['dashboard', 'apps', 'keys', 'users', 'variables', 'files', 'logs'];
  navIds.forEach(id => {
    const el = document.getElementById(`nav-${id}`);
    if (!el) return;
    if (id === tabName) {
      el.className = "flex items-center space-x-3 px-4 py-3 rounded text-sm font-semibold transition-all text-cyan-400 bg-cyan-950/20 border-l-2 border-cyan-400";
    } else {
      el.className = "flex items-center space-x-3 px-4 py-3 rounded text-sm font-semibold transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-900/50 border-l-2 border-transparent";
    }
  });

  // Toggle View Visibility
  const viewIds = ['dashboard', 'apps', 'keys', 'users', 'variables', 'files', 'logs'];
  viewIds.forEach(id => {
    const el = document.getElementById(`view-${id}`);
    if (!el) return;
    if (id === tabName) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  // Update headers
  const title = document.getElementById('page-title');
  const desc = document.getElementById('page-desc');

  if (tabName === 'dashboard') {
    title.innerText = 'OVERVIEW';
    desc.innerText = 'Real-time licensing metrics and threat monitoring.';
  } else if (tabName === 'apps') {
    title.innerText = 'APPLICATIONS';
    desc.innerText = 'Manage your apps — each has a unique App ID, Owner ID, and secret.';
  } else if (tabName === 'keys') {
    title.innerText = 'LICENSES';
    desc.innerText = 'Generate, configure, and monitor license keys.';
  } else if (tabName === 'users') {
    title.innerText = 'USERS';
    desc.innerText = 'Manage registered user accounts and associated sessions.';
  } else if (tabName === 'variables') {
    title.innerText = 'VARIABLES';
    desc.innerText = 'Manage remote secure variables fetched dynamically by clients.';
  } else if (tabName === 'files') {
    title.innerText = 'FILES';
    desc.innerText = 'Manage files streamed directly into client application memory.';
  } else if (tabName === 'logs') {
    title.innerText = 'AUDIT LOGS';
    desc.innerText = 'Detailed audit trail of license checks, registrations, and logins.';
  }

  loadTab(tabName);
}

function loadTab(tabName) {
  if (tabName === 'dashboard') loadDashboard();
  else if (tabName === 'apps') loadApps();
  else if (tabName === 'keys') loadKeys();
  else if (tabName === 'users') loadUsers();
  else if (tabName === 'variables') loadVariables();
  else if (tabName === 'files') loadFiles();
  else if (tabName === 'logs') loadLogs();
}

// 1. Dashboard Tab
async function loadDashboard() {
  try {
    const res = await fetch('/api/admin/stats', {
      headers: { 'x-admin-token': adminToken }
    });
    if (!res.ok) return;

    const data = await res.json();
    document.getElementById('stat-total-apps').innerText  = data.totalApps  || 0;
    document.getElementById('stat-total-keys').innerText  = data.totalKeys  || 0;
    document.getElementById('stat-active-users').innerText = data.totalUsers || 0;
    document.getElementById('stat-unused-keys').innerText = data.unusedKeys || 0;
    document.getElementById('stat-banned-users').innerText = (data.bannedUsers || 0) + (data.bannedKeys || 0);

    // Render recent logs table
    const tbody = document.getElementById('dashboard-logs-tbody');
    tbody.innerHTML = '';
    
    if (data.recentLogs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-500">No logs found</td></tr>`;
      return;
    }

    data.recentLogs.forEach(log => {
      const row = document.createElement('tr');
      row.className = 'border-b border-slate-900 hover:bg-slate-900/35 transition-colors';
      row.innerHTML = `
        <td class="py-3 px-4 text-slate-400 text-xs">${new Date(log.timestamp).toLocaleString()}</td>
        <td class="py-3 px-4 font-bold ${log.action.includes('Ban') ? 'text-red-400' : 'text-slate-300'}">${log.action}</td>
        <td class="py-3 px-4 text-cyan-400">${log.username || 'System'}</td>
        <td class="py-3 px-4 text-slate-400 text-xs">${log.ip || 'N/A'}</td>
        <td class="py-3 px-4 text-slate-500 text-xs truncate max-w-xs">${log.hwid || 'N/A'}</td>
      `;
      tbody.appendChild(row);
    });
    lucide.createIcons();
  } catch (error) {
    console.error(error);
  }
}

// 2. Licenses Tab
async function loadKeys() {
  try {
    const res = await fetch('/api/admin/keys', {
      headers: { 'x-admin-token': adminToken }
    });
    if (!res.ok) return;

    keysData = await res.json();
    renderKeysTable(keysData);
    populateAppSelector();
  } catch (error) {
    console.error(error);
  }
}

function renderKeysTable(data) {
  const tbody = document.getElementById('keys-tbody');
  tbody.innerHTML = '';

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-500">No license keys generated yet</td></tr>`;
    return;
  }

  data.forEach(license => {
    const isBanned = license.status === 'banned';
    const isUnused = license.status === 'unused';
    
    let statusBadge = '';
    if (isBanned) {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-red-950 text-red-400 border border-red-500/20">Banned</span>`;
    } else if (isUnused) {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-500/20">Unused</span>`;
    } else {
      statusBadge = `<span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-cyan-950 text-cyan-400 border border-cyan-500/20">Active</span>`;
    }

    const durationText = license.durationDays === 9999 ? 'Lifetime' : `${license.durationDays} Days`;
    const expiryText = license.expiry ? new Date(license.expiry).toLocaleDateString() : 'N/A';
    const hwidText = license.hwid ? 'Bound' : 'Not Bound';
    const hwidColor = license.hwid ? 'text-purple-400' : 'text-slate-500';

    const row = document.createElement('tr');
    row.className = 'border-b border-slate-900 hover:bg-slate-900/35 transition-colors font-mono text-xs';
    row.innerHTML = `
      <td class="py-4 px-4 font-bold text-slate-200 select-all">${license.key}</td>
      <td class="py-4 px-4 text-slate-300">${durationText}</td>
      <td class="py-4 px-4 text-slate-400">${expiryText}</td>
      <td class="py-4 px-4 ${hwidColor}">${hwidText}</td>
      <td class="py-4 px-4">${statusBadge}</td>
      <td class="py-4 px-4 text-right space-x-2">
        <button onclick="resetHwid('${license.key}')" title="Reset HWID" class="p-1.5 bg-purple-950 hover:bg-purple-900 border border-purple-500/20 text-purple-400 rounded transition-all">
          <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>
        </button>
        <button onclick="banKey('${license.key}', '${isBanned ? 'unban' : 'ban'}')" title="${isBanned ? 'Unban Key' : 'Ban Key'}" class="p-1.5 ${isBanned ? 'bg-emerald-950 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-900' : 'bg-yellow-950 border border-yellow-500/20 text-yellow-400 hover:bg-yellow-900'} rounded transition-all">
          <i data-lucide="${isBanned ? 'check' : 'ban'}" class="w-3.5 h-3.5"></i>
        </button>
        <button onclick="deleteKey('${license._id}')" title="Delete Key" class="p-1.5 bg-red-950 hover:bg-red-900 border border-red-500/20 text-red-400 rounded transition-all">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
  lucide.createIcons();
}

function filterKeys() {
  const query = document.getElementById('keys-search').value.toLowerCase();
  const filtered = keysData.filter(license => license.key.toLowerCase().includes(query));
  renderKeysTable(filtered);
}

// Populate app selector for key generation
async function populateAppSelector() {
  const sel = document.getElementById('gen-appid');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">Select an app...</option>';
  try {
    const res = await fetch('/api/admin/apps', { headers: { 'x-admin-token': adminToken } });
    if (res.ok) {
      const apps = await res.json();
      apps.forEach(app => {
        const opt = document.createElement('option');
        opt.value = app.appId;
        opt.textContent = `${app.name} (${app.appId})`;
        sel.appendChild(opt);
      });
      if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
    }
  } catch (e) { console.error(e); }
}

// Generate License Keys
document.getElementById('key-gen-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const appId = document.getElementById('gen-appid').value;
  const amount = document.getElementById('gen-amount').value;
  const durationDays = document.getElementById('gen-duration').value;
  const note = document.getElementById('gen-note').value.trim();

  if (!appId) { toast('Please select an app first', 'error'); return; }

  try {
    const res = await fetch('/api/admin/keys/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ appId, amount, durationDays, note })
    });

    if (res.ok) {
      document.getElementById('gen-note').value = '';
      loadKeys();
      toast('License keys generated!', 'success');
    } else {
      const data = await res.json();
      toast(data.error || 'Failed to generate keys', 'error');
    }
  } catch (error) {
    console.error(error);
  }
});

async function resetHwid(key) {
  if (!confirm(`Are you sure you want to reset HWID for license: ${key}?`)) return;
  try {
      const res = await fetch('/api/admin/keys/reset-hwid', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ key })
    });
    if (res.ok) loadKeys();
  } catch (error) {
    console.error(error);
  }
}

async function banKey(key, action) {
  const reason = action === 'ban' ? prompt('Enter reason for banning this key:') : '';
  if (action === 'ban' && reason === null) return; // Cancelled
  
  try {
    const res = await fetch('/api/admin/keys/ban', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ key, banReason: reason })
    });
    if (res.ok) loadKeys();
  } catch (error) {
    console.error(error);
  }
}

async function deleteKey(id) {
  if (!confirm('Are you sure you want to delete this license key?')) return;
  try {
    const res = await fetch(`/api/admin/keys/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });
    if (res.ok) loadKeys();
  } catch (error) {
    console.error(error);
  }
}

// 3. Users Tab
async function loadUsers() {
  try {
    const res = await fetch('/api/admin/users', {
      headers: { 'x-admin-token': adminToken }
    });
    if (!res.ok) return;

    usersData = await res.json();
    renderUsersTable(usersData);
  } catch (error) {
    console.error(error);
  }
}

function renderUsersTable(data) {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '';

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-500">No client accounts registered yet</td></tr>`;
    return;
  }

  data.forEach(user => {
    const statusBadge = user.banned 
      ? `<span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-red-950 text-red-400 border border-red-500/20">Suspended</span>`
      : `<span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-500/20">Clear</span>`;

    const row = document.createElement('tr');
    row.className = 'border-b border-slate-900 hover:bg-slate-900/35 transition-colors font-mono text-xs';
    row.innerHTML = `
      <td class="py-4 px-4 font-bold text-slate-200 select-all">${user.username}</td>
      <td class="py-4 px-4 text-slate-400 truncate max-w-[120px]" title="${user.licenseKey}">${user.licenseKey}</td>
      <td class="py-4 px-4 text-slate-400 truncate max-w-[150px]" title="${user.hwid || 'None'}">${user.hwid || 'None'}</td>
      <td class="py-4 px-4 text-slate-500">${new Date(user.createdAt).toLocaleDateString()}</td>
      <td class="py-4 px-4">${statusBadge}</td>
      <td class="py-4 px-4 text-right space-x-2">
        <button onclick="banUser('${user.username}', ${user.banned})" title="${user.banned ? 'Unban User' : 'Ban User'}" class="p-1.5 ${user.banned ? 'bg-emerald-950 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-900' : 'bg-yellow-950 border border-yellow-500/20 text-yellow-400 hover:bg-yellow-900'} rounded transition-all">
          <i data-lucide="${user.banned ? 'check' : 'ban'}" class="w-3.5 h-3.5"></i>
        </button>
        <button onclick="deleteUser('${user._id}')" title="Delete User" class="p-1.5 bg-red-950 hover:bg-red-900 border border-red-500/20 text-red-400 rounded transition-all">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </td>
    `;
    tbody.appendChild(row);
  });
  lucide.createIcons();
}

function filterUsers() {
  const query = document.getElementById('users-search').value.toLowerCase();
  const filtered = usersData.filter(user => 
    user.username.toLowerCase().includes(query) || 
    user.licenseKey.toLowerCase().includes(query)
  );
  renderUsersTable(filtered);
}

function openCreateUserModal() {
  document.getElementById('new-user-username').value = '';
  document.getElementById('new-user-password').value = '';
  document.getElementById('new-user-license').value = '';
  document.getElementById('new-user-appid').value = '';
  document.getElementById('modal-create-user').classList.remove('hidden');
}

async function createUser() {
  const username   = document.getElementById('new-user-username').value.trim();
  const password   = document.getElementById('new-user-password').value.trim();
  const licenseKey = document.getElementById('new-user-license').value.trim() || undefined;
  const appId      = document.getElementById('new-user-appid').value.trim() || undefined;

  if (!username || !password) { toast('Username and password are required', 'error'); return; }

  try {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ username, password, licenseKey, appId })
    });
    const data = await res.json();
    if (res.ok) {
      closeModal('modal-create-user');
      loadUsers();
      toast(`User "${username}" created successfully!`, 'success');
    } else {
      toast(data.error || 'Failed to create user', 'error');
    }
  } catch (e) { toast('Server connection error', 'error'); }
}

async function banUser(username, isBanned) {
  const reason = !isBanned ? prompt('Enter reason for banning user:') : '';
  if (!isBanned && reason === null) return;
  
  try {
    const res = await fetch('/api/admin/users/ban', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ username, banReason: reason })
    });
    if (res.ok) loadUsers();
  } catch (error) {
    console.error(error);
  }
}

async function deleteUser(id) {
  if (!confirm('Are you sure you want to delete this user?')) return;
  try {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });
    if (res.ok) loadUsers();
  } catch (error) {
    console.error(error);
  }
}

// 4. Variables Tab
async function loadVariables() {
  try {
    const res = await fetch('/api/admin/variables', {
      headers: { 'x-admin-token': adminToken }
    });
    if (!res.ok) return;

    const data = await res.json();
    const tbody = document.getElementById('variables-tbody');
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" class="py-8 text-center text-slate-500">No variables created yet</td></tr>`;
      return;
    }

    data.forEach(v => {
      const row = document.createElement('tr');
      row.className = 'border-b border-slate-900 hover:bg-slate-900/35 transition-colors font-mono text-xs';
      row.innerHTML = `
        <td class="py-4 px-4 font-bold text-slate-200 select-all">${v.name}</td>
        <td class="py-4 px-4 text-purple-400 select-all">${v.value}</td>
        <td class="py-4 px-4 text-right">
          <button onclick="editVariable('${v.name}', '${v.value}')" class="p-1.5 bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/20 text-cyan-400 rounded transition-all mr-2">
            <i data-lucide="edit" class="w-3.5 h-3.5"></i>
          </button>
          <button onclick="deleteVariable('${v._id}')" class="p-1.5 bg-red-950 hover:bg-red-900 border border-red-500/20 text-red-400 rounded transition-all">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      `;
      tbody.appendChild(row);
    });
    lucide.createIcons();
  } catch (error) {
    console.error(error);
  }
}

document.getElementById('var-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('var-name').value.trim();
  const value = document.getElementById('var-value').value.trim();

  try {
    const res = await fetch('/api/admin/variables', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-token': adminToken
      },
      body: JSON.stringify({ name, value })
    });
    if (res.ok) {
      document.getElementById('var-name').value = '';
      document.getElementById('var-value').value = '';
      loadVariables();
    }
  } catch (error) {
    console.error(error);
  }
});

function editVariable(name, value) {
  document.getElementById('var-name').value = name;
  document.getElementById('var-value').value = value;
}

async function deleteVariable(id) {
  if (!confirm('Delete variable?')) return;
  try {
    const res = await fetch(`/api/admin/variables/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });
    if (res.ok) loadVariables();
  } catch (error) {
    console.error(error);
  }
}

// 5. Files Tab
async function loadFiles() {
  try {
    const res = await fetch('/api/admin/files', {
      headers: { 'x-admin-token': adminToken }
    });
    if (!res.ok) return;

    const data = await res.json();
    const tbody = document.getElementById('files-tbody');
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" class="py-8 text-center text-slate-500">No secure files managed yet</td></tr>`;
      return;
    }

    data.forEach(file => {
      const row = document.createElement('tr');
      row.className = 'border-b border-slate-900 hover:bg-slate-900/35 transition-colors font-mono text-xs';
      row.innerHTML = `
        <td class="py-4 px-4 font-bold text-slate-200">${file.name}</td>
        <td class="py-4 px-4 text-cyan-400">${file.fileName}</td>
        <td class="py-4 px-4 text-slate-400 select-all font-mono">${file.hash}</td>
        <td class="py-4 px-4 text-right">
          <button onclick="deleteFile('${file._id}')" class="p-1.5 bg-red-950 hover:bg-red-900 border border-red-500/20 text-red-400 rounded transition-all">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </td>
      `;
      tbody.appendChild(row);
    });
    lucide.createIcons();
  } catch (error) {
    console.error(error);
  }
}

// File Upload handler (Convert to Base64 and send)
document.getElementById('file-upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('file-name-var').value.trim();
  const fileInput = document.getElementById('file-input');
  
  if (fileInput.files.length === 0) return;
  const file = fileInput.files[0];
  const fileName = file.name;

  const reader = new FileReader();
  reader.onload = async () => {
    const base64Data = reader.result.split(',')[1]; // Get only raw base64 data
    
    try {
      const res = await fetch('/api/admin/files', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken
        },
        body: JSON.stringify({ name, fileName, base64Data })
      });

      if (res.ok) {
        document.getElementById('file-name-var').value = '';
        fileInput.value = '';
        loadFiles();
      }
    } catch (error) {
      console.error(error);
    }
  };
  reader.readAsDataURL(file);
});

async function deleteFile(id) {
  if (!confirm('Delete this managed file?')) return;
  try {
    const res = await fetch(`/api/admin/files/${id}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });
    if (res.ok) loadFiles();
  } catch (error) {
    console.error(error);
  }
}

// 6. Logs Tab
async function loadLogs() {
  try {
    const res = await fetch('/api/admin/logs', {
      headers: { 'x-admin-token': adminToken }
    });
    if (!res.ok) return;

    const data = await res.json();
    const tbody = document.getElementById('logs-tbody');
    tbody.innerHTML = '';

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="py-8 text-center text-slate-500 font-mono text-xs">Audit trail empty</td></tr>`;
      return;
    }

    data.forEach(log => {
      const row = document.createElement('tr');
      row.className = 'border-b border-slate-900 hover:bg-slate-900/35 transition-colors font-mono text-xs';
      row.innerHTML = `
        <td class="py-3.5 px-4 text-slate-400 text-xs">${new Date(log.timestamp).toLocaleString()}</td>
        <td class="py-3.5 px-4 font-bold ${log.action.includes('Ban') ? 'text-red-400' : 'text-slate-200'}">${log.action}</td>
        <td class="py-3.5 px-4 text-cyan-400">${log.username || 'System'}</td>
        <td class="py-3.5 px-4 text-slate-400">${log.ip || 'N/A'}</td>
        <td class="py-3.5 px-4 text-slate-500 truncate max-w-xs" title="${log.hwid || 'None'}">${log.hwid || 'N/A'}</td>
      `;
      tbody.appendChild(row);
    });
    lucide.createIcons();
  } catch (error) {
    console.error(error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPLICATIONS TAB
// ═══════════════════════════════════════════════════════════════════════════════

async function loadApps() {
  const grid = document.getElementById('apps-grid');
  grid.innerHTML = '<div class="col-span-full text-center text-slate-500 py-12 font-mono text-sm">Loading...</div>';
  try {
    const res = await fetch('/api/admin/apps', { headers: { 'x-admin-token': adminToken } });
    const apps = await res.json();
    appsData = apps;

    if (!apps.length) {
      grid.innerHTML = `<div class="col-span-full text-center text-slate-600 py-16 font-mono text-sm">
        <i class="block text-4xl mb-3">📦</i>No applications yet. Click <strong class="text-cyan-400">New Application</strong> to create one.
      </div>`;
      return;
    }

    grid.innerHTML = apps.map(app => `
      <div class="bg-[#0E1117] border border-slate-800 hover:border-cyan-500/40 rounded-lg p-5 transition-all cursor-pointer group relative overflow-hidden"
           onclick="openAppDetail('${app.appId}')">
        <div class="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-cyan-500/40 to-purple-600/40 group-hover:from-cyan-500 group-hover:to-purple-600 transition-all"></div>
        <div class="flex items-start justify-between mb-4">
          <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/20 to-purple-600/20 border border-cyan-500/20 flex items-center justify-center">
            <i data-lucide="box" class="w-5 h-5 text-cyan-400"></i>
          </div>
          <span class="text-xs px-2 py-1 rounded font-bold uppercase tracking-wider ${app.status === 'active' ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-500/20' : 'bg-red-900/30 text-red-400 border border-red-500/20'}">
            ${app.status}
          </span>
        </div>
        <h3 class="font-bold text-slate-100 text-base mb-1 font-['Orbitron'] tracking-wide truncate">${app.name}</h3>
        <p class="text-xs text-slate-500 font-mono mb-3 truncate">ID: ${app.appId}</p>
        <div class="flex gap-3 text-xs text-slate-400 font-mono border-t border-slate-800 pt-3 mt-3">
          <span>v${app.version}</span>
          <span class="text-slate-700">|</span>
          <span>${app.hwidLock ? '🔒 HWID Lock' : '🔓 No HWID'}</span>
          <span class="text-slate-700">|</span>
          <span>${new Date(app.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
    `).join('');
    lucide.createIcons();
  } catch(e) {
    grid.innerHTML = '<div class="col-span-full text-center text-red-400 py-12 font-mono text-sm">Failed to load apps. Check server connection.</div>';
  }
}

function openCreateAppModal() {
  document.getElementById('new-app-name').value = '';
  document.getElementById('new-app-version').value = '';
  document.getElementById('new-app-hwid').checked = true;
  document.getElementById('modal-create-app').classList.remove('hidden');
}

async function createApp() {
  const name    = document.getElementById('new-app-name').value.trim();
  const version = document.getElementById('new-app-version').value.trim() || '1.0.0';
  const hwidLock = document.getElementById('new-app-hwid').checked;

  if (!name) { alert('App name is required'); return; }

  try {
    const res = await fetch('/api/admin/apps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ name, version, hwidLock })
    });
    const data = await res.json();
    if (res.ok) {
      closeModal('modal-create-app');
      loadApps();
      toast('Application created successfully!', 'success');
    } else {
      toast(data.error || 'Failed to create app', 'error');
    }
  } catch(e) { toast('Server connection error', 'error'); }
}

async function openAppDetail(appId) {
  currentAppId = appId;
  try {
    const res = await fetch(`/api/admin/apps/${appId}`, { headers: { 'x-admin-token': adminToken } });
    const app = await res.json();

    document.getElementById('detail-app-name').innerText   = app.name.toUpperCase();
    document.getElementById('detail-owner-id').innerText   = app.ownerId;
    document.getElementById('detail-app-id').innerText     = app.appId;
    document.getElementById('detail-app-secret').innerText = app.appSecret;
    document.getElementById('detail-version').innerText    = app.version;
    document.getElementById('detail-status').innerText     = app.status.toUpperCase();
    document.getElementById('detail-user-count').innerText = app.userCount || 0;
    document.getElementById('detail-key-count').innerText  = app.keyCount  || 0;
    document.getElementById('detail-hwid-lock').innerText  = app.hwidLock ? 'Enabled ✅' : 'Disabled ❌';
    document.getElementById('detail-created-at').innerText = new Date(app.createdAt).toLocaleString();
    document.getElementById('detail-status').className     = `mt-1 ${app.status === 'active' ? 'text-emerald-400' : 'text-red-400'}`;

    document.getElementById('modal-app-detail').classList.remove('hidden');
  } catch(e) { toast('Failed to load app details', 'error'); }
}

async function regenSecret() {
  if (!currentAppId) return;
  if (!confirm('Regenerate the App Secret? All C# clients using the old secret will fail.')) return;
  try {
    const res = await fetch(`/api/admin/apps/${currentAppId}/regen-secret`, {
      method: 'POST', headers: { 'x-admin-token': adminToken }
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById('detail-app-secret').innerText = data.appSecret;
      toast('Secret regenerated! Update your C# client.', 'warning');
    } else { toast(data.error, 'error'); }
  } catch(e) { toast('Server connection error', 'error'); }
}

async function deleteCurrentApp() {
  if (!currentAppId) return;
  const appName = document.getElementById('detail-app-name').innerText;
  if (!confirm(`DELETE "${appName}" and ALL its users, keys, and data? This cannot be undone.`)) return;
  try {
    const res = await fetch(`/api/admin/apps/${currentAppId}`, {
      method: 'DELETE', headers: { 'x-admin-token': adminToken }
    });
    if (res.ok) {
      closeModal('modal-app-detail');
      currentAppId = null;
      loadApps();
      toast('Application and all data deleted.', 'warning');
    } else {
      const data = await res.json();
      toast(data.error || 'Delete failed', 'error');
    }
  } catch(e) { toast('Server connection error', 'error'); }
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}
