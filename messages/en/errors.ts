/** Error and status pages: not-found, the console error boundary, no-access, maintenance. */
const errors = {
  notFoundTitle: "Page not found",
  notFoundText: "The page you are looking for doesn't exist or may have moved.",
  backToHome: "Back to home",
  errorTitle: "Something went wrong",
  errorWithRef: "An unexpected error occurred. Reference: {digest}",
  errorGeneric: "An unexpected error occurred. Please try again.",
  tryAgain: "Try again",
  noAccessTitle: "No access",
  accessRestricted: "Access restricted",
  accessRestrictedText: "You don't have permission to view this area.",
  cantAccess: "You can't access this area",
  limitedToRole:
    "This area is limited to {required} and above. Your current role is {role}. Ask an administrator if you need access.",
  roleNoPermission:
    "Your current role ({role}) doesn't have permission to view this area. Ask an administrator if you need access.",
  backToDashboard: "Back to dashboard",
  maintenanceTitle: "Maintenance",
  maintenanceUpdate: "Servio is being updated. It will be back in a few minutes.",
  maintenanceGeneral: "Servio is down for scheduled maintenance. It will be back shortly.",
};

export default errors;
