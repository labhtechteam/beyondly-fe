// Hides [data-requires-auth] sections and shows #authRequiredNotice when the
// user has no access token. Returns true if the page's real content should run.
function requireSignedInUser() {
  if (isUserSignedIn()) {
    return true;
  }

  $("[data-requires-auth]").addClass("d-none");
  $("#authRequiredNotice").removeClass("d-none");
  return false;
}
