// Base URL of the Django API. Change this if the backend runs elsewhere.
var BEYONDLY_API_BASE_URL = "http://127.0.0.1:8000/api";
var BEYONDLY_TOKEN_STORAGE_KEY = "beyondly_access_token";

// Reads the currently stored bearer token, or "" if the user is signed out.
function getStoredAccessToken() {
  return localStorage.getItem(BEYONDLY_TOKEN_STORAGE_KEY) || "";
}

// Persists a bearer token returned by the OTP/register endpoints.
function setStoredAccessToken(token) {
  localStorage.setItem(BEYONDLY_TOKEN_STORAGE_KEY, token);
}

// Clears the stored bearer token (sign out, or an expired/invalid token).
function clearStoredAccessToken() {
  localStorage.removeItem(BEYONDLY_TOKEN_STORAGE_KEY);
}

// True once the user has completed the phone OTP step and holds a token.
function isUserSignedIn() {
  return !!getStoredAccessToken();
}

// Turns a plain object into a "?a=1&b=2" query string, skipping empty values.
function buildQueryString(params) {
  if (!params) {
    return "";
  }

  var parts = [];
  Object.keys(params).forEach(function (key) {
    var value = params[key];
    if (value !== undefined && value !== null && value !== "") {
      parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
    }
  });

  return parts.length ? "?" + parts.join("&") : "";
}

// Calls a Beyondly API endpoint and returns the jQuery promise from $.ajax.
// options: { query: {...} } for GET requests, { body: {...} } for POST requests,
// or { formData: FormData } to send a multipart (file upload) body.
function callBeyondlyApi(method, path, options) {
  options = options || {};

  var headers = {};
  var token = getStoredAccessToken();
  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  var ajaxSettings = {
    url: BEYONDLY_API_BASE_URL + path + (method === "GET" ? buildQueryString(options.query) : ""),
    method: method,
    headers: headers,
    dataType: "json",
  };

  if (options.formData) {
    ajaxSettings.processData = false;
    ajaxSettings.contentType = false;
    ajaxSettings.data = options.formData;
  } else if (method !== "GET") {
    ajaxSettings.contentType = "application/json";
    ajaxSettings.data = JSON.stringify(options.body || {});
  }

  return $.ajax(ajaxSettings).fail(function (jqXHR) {
    if (jqXHR.status === 401) {
      clearStoredAccessToken();
    }
  });
}

// Pulls a human-readable message out of a failed API response.
function extractApiErrorMessage(jqXHR) {
  if (jqXHR && jqXHR.responseJSON && jqXHR.responseJSON.error) {
    return jqXHR.responseJSON.error;
  }
  if (jqXHR && jqXHR.status === 0) {
    return "Could not reach the Beyondly API. Is the backend running?";
  }
  return "Something went wrong. Please try again.";
}
