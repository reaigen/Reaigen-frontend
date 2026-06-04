/**
 * English — base locale (source of truth).
 *
 * Every key defined here becomes a required field in all other language packs.
 * Keys follow the pattern: `section.screen.element` (dot-separated, camelCase).
 *
 * Adding a new key:
 *   1. Add it here with the English value.
 *   2. TypeScript will flag every other locale file until you add the translation.
 */

const en = {

  // ── Navigation ────────────────────────────────────────────────────────
  "nav.dashboard":                       "Dashboard",
  "nav.shares":                          "Shares",
  "nav.settings":                        "Settings",
  "nav.signout":                         "Sign out",

  // ── Auth ──────────────────────────────────────────────────────────────
  "auth.login.title":                    "Welcome back",
  "auth.login.subtitle":                 "Sign in to your creator account",
  "auth.login.emailLabel":               "Email",
  "auth.login.emailPlaceholder":         "you@email.com",
  "auth.login.passwordLabel":            "Password",
  "auth.login.passwordPlaceholder":      "Enter password",
  "auth.login.rememberMe":               "Remember me",
  "auth.login.forgot":                   "Forgot?",
  "auth.login.forgotSending":            "Sending...",
  "auth.login.forgotSent":               "Reset link sent",
  "auth.login.submit":                   "Sign in",
  "auth.login.switchToRegister":         "Create an account",
  "auth.login.socialDivider":            "or",

  "auth.register.title":                 "Create account",
  "auth.register.subtitle":              "Join Reaigen as a creator.",
  "auth.register.firstNameLabel":        "First name",
  "auth.register.firstNamePlaceholder":  "First name",
  "auth.register.lastNameLabel":         "Last name",
  "auth.register.lastNamePlaceholder":   "Last name",
  "auth.register.emailLabel":            "Email address",
  "auth.register.emailPlaceholder":      "you@email.com",
  "auth.register.passwordLabel":         "Password",
  "auth.register.passwordPlaceholder":   "Min. 8 characters",
  "auth.register.confirmLabel":          "Confirm password",
  "auth.register.confirmPlaceholder":    "Re-enter",
  "auth.register.passwordMismatch":      "Passwords do not match.",
  "auth.register.terms":                 "I agree to the Terms of Service and Privacy Policy",
  "auth.register.submit":                "Create account",
  "auth.register.switchToLogin":         "Already have an account? Sign in",

  "auth.social.google":                  "Google",
  "auth.social.apple":                   "Apple",

  // ── Dashboard ─────────────────────────────────────────────────────────
  "dashboard.title":                     "Dashboard",
  "dashboard.welcome":                   "Welcome back",

  "dashboard.statTotal":                 "Total Tours",
  "dashboard.statLive":                  "Live",
  "dashboard.statProcessing":            "In Progress",

  "dashboard.virtualTours":              "Virtual Tours",
  "dashboard.viewTour":                  "View Tour",
  "dashboard.loadMore":                  "Load more",
  "dashboard.searchPlaceholder":         "Search tours…",
  "dashboard.share":                     "Share",
  "dashboard.linkCopied":                "Link copied!",
  "dashboard.noSplatsTitle":             "No tours yet",
  "dashboard.noSplats":                  "Upload a scan from the app to create your first tour.",

  "dashboard.quickActions":              "Quick Actions",
  "dashboard.editSettings":              "Edit Profile & Settings",

  // ── Shared Links ─────────────────────────────────────────────────────
  "shares.title":                        "Shared Links",
  "shares.noShares":                     "No shared links yet.",
  "shares.noSharesHint":                 "Share a tour to create a link.",
  "shares.statusActive":                 "Active",
  "shares.statusPaused":                 "Paused",
  "shares.statusExpired":                "Expired",
  "shares.statusRevoked":                "Revoked",
  "shares.copyLink":                     "Copy",
  "shares.copied":                       "Copied",
  "shares.pause":                        "Pause",
  "shares.resume":                       "Resume",
  "shares.revoke":                       "Revoke",
  "shares.revokeConfirm":                "This cannot be undone",
  "shares.cancel":                       "Cancel",
  "shares.views":                        "views",
  "shares.pinProtected":                 "PIN",
  "shares.expires":                      "Expires",
  "shares.viewLimit":                    "Limit",
  "shares.totalViews":                   "Total Views",
  "shares.uniqueVisitors":               "Unique Visitors",
  "shares.failedPins":                   "Failed PINs",
  "shares.created":                      "Created",
  "shares.allShares":                    "All Shares",
  "shares.activeOnly":                   "Active",
  "shares.analytics":                    "Analytics",
  "shares.manage":                       "Manage",

  // ── Profile ───────────────────────────────────────────────────────────
  "profile.title":                       "Profile",
  "profile.plan":                        "Plan",
  "profile.trial":                       "Trial",

  // ── Settings ──────────────────────────────────────────────────────────
  "settings.title":                      "Settings",
  "settings.subtitle":                   "Your account preferences.",

  "settings.tab.profile":                "Profile",
  "settings.tab.seller":                 "Seller Profile",
  "settings.tab.privacy":                "Privacy",
  "settings.tab.localization":           "Language & Region",
  "settings.tab.notifications":          "Notifications",
  "settings.tab.security":               "Security",

  "settings.profile.title":              "Profile",
  "settings.profile.subtitle":           "Your personal details.",
  "settings.profile.firstName":          "First name",
  "settings.profile.lastName":           "Last name",
  "settings.profile.username":           "Username",
  "settings.profile.email":              "Email",
  "settings.profile.emailHint":          "Email cannot be changed.",
  "settings.profile.save":              "Save changes",
  "settings.profile.saved":             "Saved successfully.",

  "settings.localization.title":         "Language & Region",
  "settings.localization.subtitle":      "Choose your language and display preferences.",
  "settings.localization.language":       "Language",
  "settings.localization.timezone":       "Timezone",
  "settings.localization.currency":       "Currency",
  "settings.localization.dateFormat":     "Date format",
  "settings.localization.areaUnit":       "Area unit",
  "settings.localization.distanceUnit":   "Distance unit",
  "settings.localization.save":          "Save preferences",
  "settings.localization.saved":         "Saved successfully.",

  // Seller Profile
  "settings.seller.title":               "Seller Profile",
  "settings.seller.subtitle":            "Info visible to your clients.",
  "settings.seller.phone":               "Phone",
  "settings.seller.company":             "Company",
  "settings.seller.website":             "Website",
  "settings.seller.bio":                 "Bio",
  "settings.seller.jobTitle":            "Job title",
  "settings.seller.linkedin":            "LinkedIn URL",
  "settings.seller.twitter":             "Twitter / X",
  "settings.seller.instagram":           "Instagram",
  "settings.seller.reAgent":             "Real estate professional",
  "settings.seller.license":             "License number",
  "settings.seller.agency":              "Agency name",
  "settings.seller.address":             "Address",
  "settings.seller.city":                "City",
  "settings.seller.state":               "State / Province",
  "settings.seller.country":             "Country",
  "settings.seller.postalCode":          "Postal code",
  "settings.seller.save":               "Save profile",
  "settings.seller.saved":              "Profile saved.",

  // Privacy
  "settings.privacy.title":              "Privacy",
  "settings.privacy.subtitle":           "Choose who sees your info.",
  "settings.privacy.publicProfile":      "Public profile",
  "settings.privacy.publicProfileHint":  "Your profile is visible to other users.",
  "settings.privacy.showEmail":          "Show email",
  "settings.privacy.showEmailHint":      "Others can see your email address.",
  "settings.privacy.showPhone":          "Show phone",
  "settings.privacy.showPhoneHint":      "Others can see your phone number.",
  "settings.privacy.allowContact":       "Allow contact",
  "settings.privacy.allowContactHint":   "Others can send you messages.",
  "settings.privacy.save":              "Save privacy settings",
  "settings.privacy.saved":             "Privacy settings saved.",

  // Notifications
  "settings.notifications.title":        "Notifications",
  "settings.notifications.subtitle":     "What we should let you know about.",
  "settings.notifications.master":       "Enable notifications",
  "settings.notifications.email":        "Email notifications",
  "settings.notifications.processing":   "Tour ready",
  "settings.notifications.processingFailed": "Tour issue",
  "settings.notifications.newFeatures":  "New features",
  "settings.notifications.billing":      "Billing alerts",
  "settings.notifications.save":        "Save preferences",
  "settings.notifications.saved":       "Notification preferences saved.",

  "settings.security.title":             "Password",
  "settings.security.subtitle":          "Update your password.",
  "settings.security.currentPassword":   "Current password",
  "settings.security.newPassword":       "New password",
  "settings.security.confirmPassword":   "Confirm new password",
  "settings.security.mismatch":          "Passwords do not match.",
  "settings.security.save":             "Change password",
  "settings.security.saved":            "Password changed successfully.",

  // Billing
  "settings.tab.billing":               "Billing",
  "settings.billing.title":             "Plan & Billing",
  "settings.billing.subtitle":          "Your subscription and payment info.",
  "settings.billing.plan":              "Plan",
  "settings.billing.status":            "Status",
  "settings.billing.cycle":             "Renewal",
  "settings.billing.storage":           "Storage",
  "settings.billing.posts":             "Tours",
  "settings.billing.expires":           "Expires",
  "settings.billing.trial":             "Trial",
  "settings.billing.active":            "Active",
  "settings.billing.inactive":          "Inactive",
  "settings.billing.detailsTitle":      "Payment Info",
  "settings.billing.name":             "Name on invoice",
  "settings.billing.email":            "Invoice email",
  "settings.billing.address":          "Address",
  "settings.billing.city":             "City",
  "settings.billing.postalCode":       "Postal Code",
  "settings.billing.country":          "Country",
  "settings.billing.vat":              "Tax ID / VAT",
  "settings.billing.save":             "Save billing details",
  "settings.billing.saved":            "Billing details saved.",

} as const;

export default en;

/** Union of every valid translation key. Derived from the English pack. */
export type LocaleKey = keyof typeof en;

/** Shape that every language pack must satisfy. */
export type LocaleStrings = Record<LocaleKey, string>;
