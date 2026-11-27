const API_BASE_URL = "https://shared-calendar-api.onrender.com";
const STORAGE_KEY = "ocean_settings_admin_key";

const settingsAdminKey = document.getElementById("settingsAdminKey");
const rememberAdminKey = document.getElementById("rememberAdminKey");
const locksApiBearer = document.getElementById("locksApiBearer");
const locksApiCookie = document.getElementById("locksApiCookie");
const gapsClientId = document.getElementById("gapsClientId");
const gapsClientSecret = document.getElementById("gapsClientSecret");
const loadBtn = document.getElementById("loadBtn");
const saveBtn = document.getElementById("saveBtn");
const statusBox = document.getElementById("statusBox");

const savedAdminKey = localStorage.getItem(STORAGE_KEY) || "";

if (savedAdminKey) {
  settingsAdminKey.value = savedAdminKey;
  rememberAdminKey.checked = true;
}

rememberAdminKey.addEventListener("change", () => {
  if (rememberAdminKey.checked && settingsAdminKey.value.trim()) {
    localStorage.setItem(STORAGE_KEY, settingsAdminKey.value.trim());
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
});

settingsAdminKey.addEventListener("input", () => {
  if (rememberAdminKey.checked) {
    localStorage.setItem(STORAGE_KEY, settingsAdminKey.value.trim());
  }
});

loadBtn.addEventListener("click", loadCurrentSettings);
saveBtn.addEventListener("click", saveSettings);

function adminHeaders() {
  return {
    "content-type": "application/json",
    "x-settings-admin-key": settingsAdminKey.value.trim()
  };
}

function showStatus(message, type = "ok") {
  statusBox.textContent = message;
  statusBox.className = `status-box ${type}`;
}

function clearStatus() {
  statusBox.textContent = "";
  statusBox.className = "status-box hidden";
}

function requireAdminKey() {
  if (!settingsAdminKey.value.trim()) {
    showStatus("Paste SETTINGS_ADMIN_KEY first.", "error");
    settingsAdminKey.focus();
    return false;
  }

  return true;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (err) {
      data = { message: text };
    }
  }

  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }

  return data;
}

async function loadCurrentSettings() {
  if (!requireAdminKey()) return;

  clearStatus();
  loadBtn.disabled = true;
  loadBtn.textContent = "Loading...";

  try {
    const response = await fetch(`${API_BASE_URL}/api/settings/render-env?v=${Date.now()}`, {
      method: "GET",
      headers: adminHeaders()
    });
    const data = await parseJsonResponse(response);
    const values = data.values || {};

    locksApiBearer.value = "";
    locksApiCookie.value = "";
    locksApiBearer.placeholder = values.LOCKS_API_BEARER
      ? `Current saved: ${values.LOCKS_API_BEARER}`
      : "Paste locks API key";
    locksApiCookie.placeholder = values.LOCKS_API_COOKIE
      ? `Current saved: ${values.LOCKS_API_COOKIE}`
      : "Paste cookie only if needed";
    gapsClientId.value = "";
    gapsClientSecret.value = "";
    gapsClientId.placeholder = values.GUESTY_CLIENT_ID
      ? `Current saved: ${values.GUESTY_CLIENT_ID}`
      : "Paste Guesty client id";
    gapsClientSecret.placeholder = values.GUESTY_CLIENT_SECRET
      ? `Current saved: ${values.GUESTY_CLIENT_SECRET}`
      : "Paste Guesty client secret";

    const renderMessage = data.renderConfigured
      ? "Render is connected."
      : "Render API key or service id is missing.";

    showStatus(`Current settings loaded. ${renderMessage}`);
  } catch (err) {
    showStatus(err.message || "Failed to load current settings.", "error");
  } finally {
    loadBtn.disabled = false;
    loadBtn.textContent = "Load Current";
  }
}

async function saveSettings() {
  if (!requireAdminKey()) return;

  const body = {
    LOCKS_API_BEARER: locksApiBearer.value,
    LOCKS_API_COOKIE: locksApiCookie.value,
    GUESTY_CLIENT_ID: gapsClientId.value,
    GUESTY_CLIENT_SECRET: gapsClientSecret.value
  };

  clearStatus();
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    const response = await fetch(`${API_BASE_URL}/api/settings/render-env`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(body)
    });
    const data = await parseJsonResponse(response);
    const changed = Array.isArray(data.changed) ? data.changed.join(", ") : "";

    showStatus(`Saved to Render. Deploy started. Updated: ${changed || "settings"}.`);
  } catch (err) {
    showStatus(err.message || "Failed to save settings.", "error");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save To Render";
  }
}
