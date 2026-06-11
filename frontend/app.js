const elements = {
  authView: document.querySelector("#authView"),
  adminView: document.querySelector("#adminView"),
  loginForm: document.querySelector("#loginForm"),
  passwordResetView: document.querySelector("#passwordResetView"),
  loginUsername: document.querySelector("#loginUsername"),
  loginPassword: document.querySelector("#loginPassword"),
  loginMessage: document.querySelector("#loginMessage"),
  showPasswordResetButton: document.querySelector("#showPasswordResetButton"),
  backToLoginButton: document.querySelector("#backToLoginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  sessionLabel: document.querySelector("#sessionLabel"),
  passwordForm: document.querySelector("#passwordForm"),
  newPassword: document.querySelector("#newPassword"),
  passwordCode: document.querySelector("#passwordCode"),
  passwordResetSubtitle: document.querySelector("#passwordResetSubtitle"),
  recoveryEmailHint: document.querySelector("#recoveryEmailHint"),
  sendPasswordCodeButton: document.querySelector("#sendPasswordCodeButton"),
  passwordMessage: document.querySelector("#passwordMessage"),
  form: document.querySelector("#internForm"),
  nameInput: document.querySelector("#internName"),
  teamInput: document.querySelector("#internTeam"),
  formMessage: document.querySelector("#formMessage"),
  undoRemoveButton: document.querySelector("#undoRemoveButton"),
  list: document.querySelector("#internList"),
  template: document.querySelector("#internRowTemplate"),
  searchInput: document.querySelector("#searchInput"),
  attendanceDate: document.querySelector("#attendanceDate"),
  attendanceSession: document.querySelector("#attendanceSession"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  saveAttendanceButton: document.querySelector("#saveAttendanceButton"),
  todayLabel: document.querySelector("#todayLabel"),
  presentCount: document.querySelector("#presentCount"),
  lateCount: document.querySelector("#lateCount"),
  absentCount: document.querySelector("#absentCount"),
  leaveCount: document.querySelector("#leaveCount"),
  totalCount: document.querySelector("#totalCount"),
  resetDayButton: document.querySelector("#resetDayButton"),
  reportPeriod: document.querySelector("#reportPeriod"),
  reportDateField: document.querySelector("#reportDateField"),
  reportDateLabel: document.querySelector("#reportDateLabel"),
  reportDate: document.querySelector("#reportDate"),
  refreshReportButton: document.querySelector("#refreshReportButton"),
  detailStatusFilter: document.querySelector("#detailStatusFilter"),
  detailNameFilter: document.querySelector("#detailNameFilter"),
  detailDepartmentFilter: document.querySelector("#detailDepartmentFilter"),
  detailSortBy: document.querySelector("#detailSortBy"),
  clearDetailedFiltersButton: document.querySelector("#clearDetailedFiltersButton"),
  exportDetailedCsvButton: document.querySelector("#exportDetailedCsvButton"),
  detailFilterChips: document.querySelector("#detailFilterChips"),
  detailVisibleCount: document.querySelector("#detailVisibleCount"),
  reportLabel: document.querySelector("#reportLabel"),
  reportTotal: document.querySelector("#reportTotal"),
  reportPresent: document.querySelector("#reportPresent"),
  reportLate: document.querySelector("#reportLate"),
  reportLeave: document.querySelector("#reportLeave"),
  reportHalfDay: document.querySelector("#reportHalfDay"),
  reportAbsent: document.querySelector("#reportAbsent"),
  reportActiveInterns: document.querySelector("#reportActiveInterns"),
  reportEndField: document.querySelector("#reportEndField"),
  reportEndDate: document.querySelector("#reportEndDate"),
  reportRecords: document.querySelector("#reportRecords"),
  reportRowTemplate: document.querySelector("#reportRowTemplate"),
  detailedReportRecords: document.querySelector("#detailedReportRecords"),
  detailedReportRowTemplate: document.querySelector("#detailedReportRowTemplate")
};

const SESSION_KEY = "attendance-portal-session";
const formatDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const state = {
  token: "",
  user: null,
  date: formatDateKey(),
  attendanceSession: "morning",
  interns: [],
  summary: {
    present: 0,
    late: 0,
    absent: 0,
    leave: 0,
    totalInterns: 0
  },
  pendingAttendance: new Map(),
  lastDeletedIntern: null,
  attendanceSessionManuallyChanged: false,
  detailedReportRecords: [],
  passwordResetConfigured: true,
  passwordResetEmail: ""
};

const getAutoSessionForNow = (now = new Date()) => (now.getHours() >= 12 ? "evening" : "morning");
const isTodayDate = (date) => date === formatDateKey();
const formatReadableDate = (date) => new Intl.DateTimeFormat([], {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric"
}).format(new Date(`${date}T00:00:00`));

const statusClassMap = {
  Present: "status-present",
  Late: "status-late",
  Absent: "status-absent",
  Leave: "status-leave",
  "Half Day": "status-half-day"
};

const getDetailedReportFilters = () => ({
  status: elements.detailStatusFilter?.value || "all",
  name: elements.detailNameFilter?.value.trim().toLowerCase() || "",
  department: elements.detailDepartmentFilter?.value.trim().toLowerCase() || "",
  sortBy: elements.detailSortBy?.value || "date-desc"
});

const sortDetailedRecords = (records, sortBy) => {
  const sorted = [...records];
  sorted.sort((left, right) => {
    if (sortBy === "date-asc") {
      return left.attendanceDate.localeCompare(right.attendanceDate) || left.internName.localeCompare(right.internName);
    }
    if (sortBy === "name-asc") {
      return left.internName.localeCompare(right.internName) || left.attendanceDate.localeCompare(right.attendanceDate);
    }
    if (sortBy === "name-desc") {
      return right.internName.localeCompare(left.internName) || right.attendanceDate.localeCompare(left.attendanceDate);
    }
    if (sortBy === "status-asc") {
      return left.finalStatus.localeCompare(right.finalStatus) || left.internName.localeCompare(right.internName);
    }
    return right.attendanceDate.localeCompare(left.attendanceDate) || left.internName.localeCompare(right.internName);
  });
  return sorted;
};

const filterDetailedRecords = (records = []) => {
  const filters = getDetailedReportFilters();
  const filtered = records.filter((record) => {
    if (filters.status !== "all" && record.finalStatus !== filters.status) {
      return false;
    }
    if (filters.name && !record.internName.toLowerCase().includes(filters.name)) {
      return false;
    }
    if (filters.department && !record.team.toLowerCase().includes(filters.department)) {
      return false;
    }
    return true;
  });

  return sortDetailedRecords(filtered, filters.sortBy);
};

const updateDetailFilterChips = () => {
  if (!elements.detailFilterChips) {
    return;
  }

  const filters = getDetailedReportFilters();
  const chips = [];
  if (filters.status !== "all") {
    chips.push(`Status: ${filters.status}`);
  }
  if (filters.name) {
    chips.push(`Name: ${filters.name}`);
  }
  if (filters.department) {
    chips.push(`Department: ${filters.department}`);
  }

  elements.detailFilterChips.classList.toggle("hidden", chips.length === 0);
  elements.detailFilterChips.innerHTML = chips.map((chip) => `<span class="filter-chip">${chip}</span>`).join("");
};

const resetDetailedFilters = () => {
  if (elements.detailStatusFilter) {
    elements.detailStatusFilter.value = "all";
  }
  if (elements.detailNameFilter) {
    elements.detailNameFilter.value = "";
  }
  if (elements.detailDepartmentFilter) {
    elements.detailDepartmentFilter.value = "";
  }
  if (elements.detailSortBy) {
    elements.detailSortBy.value = "date-desc";
  }
};

const setMessage = (element, message, type = "") => {
  element.textContent = message;
  element.className = "form-message";
  if (type) {
    element.classList.add(`is-${type}`);
  }
};

const updateRecoveryEmailHint = () => {
  if (!elements.recoveryEmailHint || !elements.passwordResetSubtitle) {
    return;
  }

  if (!state.passwordResetConfigured) {
    elements.passwordResetSubtitle.textContent = "Password reset is unavailable until Gmail sender settings are configured.";
    elements.recoveryEmailHint.textContent = "";
    return;
  }

  elements.passwordResetSubtitle.textContent = "Send a code to the configured recovery Gmail, then set a new password.";
  elements.recoveryEmailHint.textContent = state.passwordResetEmail
    ? `Reset codes are sent to ${state.passwordResetEmail}. Check Inbox or Spam.`
    : "Reset codes are sent to the configured recovery Gmail inbox.";
};

const updatePasswordResetUi = () => {
  elements.sendPasswordCodeButton.disabled = !state.passwordResetConfigured;
  elements.passwordCode.disabled = !state.passwordResetConfigured;
  updateRecoveryEmailHint();

  if (!state.passwordResetConfigured) {
    setMessage(
      elements.passwordMessage,
      "Password reset email is not set up yet. Ask the admin to configure Gmail sender settings.",
      "error"
    );
  }
};

const saveSession = () => {
  if (!state.token || !state.user) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }

  localStorage.setItem(SESSION_KEY, JSON.stringify({
    token: state.token,
    user: state.user
  }));
};

const loadSession = () => {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    state.token = parsed.token || "";
    state.user = parsed.user || null;
  } catch {
    localStorage.removeItem(SESSION_KEY);
  }
};

const request = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {})
    },
    ...options
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed." }));
    if (response.status === 401 && payload.error === "Please log in first.") {
      state.token = "";
      state.user = null;
      saveSession();
      showView("auth");
      setMessage(elements.loginMessage, "Please sign in again.", "error");
    }
    throw new Error(payload.error || "Request failed.");
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
};

const loadPasswordResetStatus = async () => {
  try {
    const payload = await request("/api/auth/password-reset-status");
    state.passwordResetConfigured = Boolean(payload.configured);
    state.passwordResetEmail = payload.email || "";
  } catch {
    state.passwordResetConfigured = false;
    state.passwordResetEmail = "";
  }
};

const togglePasswordVisibility = (button) => {
  const input = document.querySelector(`#${button.dataset.passwordToggle}`);
  const isHidden = input.type === "password";

  input.type = isHidden ? "text" : "password";
  button.setAttribute("aria-label", `${isHidden ? "Hide" : "Show"} password`);
};

const getInitials = (name) => (
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("")
);

const showView = (role) => {
  elements.authView.classList.toggle("hidden", role !== "auth");
  elements.adminView.classList.toggle("hidden", role !== "admin");
};

const updateAdminStats = (summary) => {
  elements.presentCount.textContent = summary.present;
  elements.lateCount.textContent = summary.late;
  elements.absentCount.textContent = summary.absent;
  elements.leaveCount.textContent = summary.leave;
  elements.totalCount.textContent = summary.totalInterns;
};

const getDisplayedStatus = (intern) => state.pendingAttendance.get(intern.id) || intern.status;

const setSaveButtonState = () => {
  const pendingCount = state.pendingAttendance.size;
  elements.saveAttendanceButton.disabled = pendingCount === 0;
  elements.saveAttendanceButton.textContent = pendingCount
    ? `Save Attendance (${pendingCount})`
    : "Save Attendance";
};

const getSessionLabel = () => (
  state.attendanceSession === "evening" ? "Evening" : "Morning"
);

const syncAttendanceSessionWithTime = () => {
  if (!elements.attendanceSession) {
    return false;
  }

  if (!isTodayDate(state.date)) {
    return false;
  }

  if (state.attendanceSessionManuallyChanged) {
    return false;
  }

  const nextSession = getAutoSessionForNow();
  if (state.attendanceSession === nextSession && elements.attendanceSession.value === nextSession) {
    return false;
  }

  state.attendanceSession = nextSession;
  elements.attendanceSession.value = nextSession;
  return true;
};

const setAttendanceDateState = (dateValue, { preserveManualSession = false } = {}) => {
  state.date = dateValue || formatDateKey();
  const isToday = isTodayDate(state.date);

  if (isToday && !preserveManualSession) {
    state.attendanceSession = getAutoSessionForNow();
    state.attendanceSessionManuallyChanged = false;
  } else {
    state.attendanceSession = elements.attendanceSession.value || state.attendanceSession || "morning";
  }

  elements.attendanceDate.value = state.date;
  elements.attendanceSession.value = state.attendanceSession;
  if (elements.reportDate) {
    elements.reportDate.value = state.date;
  }
  if (elements.reportEndDate) {
    elements.reportEndDate.value = state.date;
  }
};

const setUndoButtonState = () => {
  elements.undoRemoveButton.classList.toggle("hidden", !state.lastDeletedIntern);
};

const markPendingAttendance = (internId, status) => {
  const intern = state.interns.find((record) => record.id === internId);

  if (!intern) {
    return;
  }

  if (intern.status === status) {
    state.pendingAttendance.delete(internId);
  } else {
    state.pendingAttendance.set(internId, status);
  }

  renderAdmin(state.summary);
  setMessage(elements.formMessage, "Attendance changes are ready to save.", "success");
};

const renderAdminRow = (intern) => {
  const fragment = elements.template.content.cloneNode(true);
  const row = fragment.querySelector(".intern-row");
  const avatar = fragment.querySelector(".intern-avatar");
  const name = fragment.querySelector(".intern-name");
  const team = fragment.querySelector(".intern-team");
  const statusPill = fragment.querySelector(".status-pill");
  const presentButton = fragment.querySelector(".status-present-button");
  const absentButton = fragment.querySelector(".status-absent-button");
  const lateButton = fragment.querySelector(".status-late-button");
  const leaveButton = fragment.querySelector(".status-leave-button");
  const deleteButton = fragment.querySelector(".delete-button");
  const displayedStatus = getDisplayedStatus(intern);
  const hasPendingChange = state.pendingAttendance.has(intern.id);

  row.dataset.id = intern.id;
  row.classList.toggle("has-pending-change", hasPendingChange);
  avatar.textContent = getInitials(intern.name);
  name.textContent = intern.name;
  team.textContent = intern.team;
  statusPill.textContent = hasPendingChange ? `${displayedStatus} pending` : displayedStatus;
  statusPill.classList.add(statusClassMap[displayedStatus] || "status-absent");
  presentButton.disabled = displayedStatus === "Present";
  absentButton.disabled = displayedStatus === "Absent";
  lateButton.disabled = displayedStatus === "Late";
  leaveButton.disabled = displayedStatus === "Leave";
  presentButton.classList.toggle("is-hidden", displayedStatus === "Present");
  absentButton.classList.toggle("is-hidden", displayedStatus === "Absent");
  lateButton.classList.toggle("is-hidden", displayedStatus === "Late");
  leaveButton.classList.toggle("is-hidden", displayedStatus === "Leave");

  presentButton.addEventListener("click", () => markPendingAttendance(intern.id, "Present"));
  absentButton.addEventListener("click", () => markPendingAttendance(intern.id, "Absent"));
  lateButton.addEventListener("click", () => markPendingAttendance(intern.id, "Late"));
  leaveButton.addEventListener("click", () => markPendingAttendance(intern.id, "Leave"));
  deleteButton.addEventListener("click", () => removeIntern(intern.id, intern.name));

  return fragment;
};

const renderAdmin = (summary) => {
  state.summary = summary;
  const query = elements.searchInput.value.trim().toLowerCase();
  const filteredInterns = state.interns.filter((intern) => (
    intern.name.toLowerCase().includes(query) ||
    intern.team.toLowerCase().includes(query)
  ));

  elements.list.innerHTML = "";
  const formattedDate = new Intl.DateTimeFormat([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${state.date}T00:00:00`));
  elements.todayLabel.textContent = `${formattedDate} - ${getSessionLabel()}`;

  if (!filteredInterns.length) {
    elements.list.innerHTML = '<p class="empty-state">No interns match this search yet.</p>';
    updateAdminStats(summary);
    return;
  }

  filteredInterns.forEach((intern) => {
    elements.list.appendChild(renderAdminRow(intern));
  });

  updateAdminStats(summary);
  setSaveButtonState();
};

const loadAdminInterns = async () => {
  const payload = await request(`/api/admin/interns?date=${state.date}&session=${state.attendanceSession}`);
  state.interns = payload.interns;
  renderAdmin(payload.summary);
};

const refreshAdminData = async () => {
  await loadAdminInterns();
  await loadAdminReport();
};

const loadSelectedAttendanceDate = async () => {
  setAttendanceDateState(elements.attendanceDate.value, { preserveManualSession: false });
  state.pendingAttendance.clear();
  await refreshAdminData();
};

const loadSelectedAttendanceSession = async () => {
  state.attendanceSession = elements.attendanceSession.value || "morning";
  state.attendanceSessionManuallyChanged = true;
  state.pendingAttendance.clear();
  await refreshAdminData();
};

const updateReportFilterVisibility = () => {
  const period = elements.reportPeriod?.value || "daily";
  const isCustom = period === "custom";

  if (elements.reportDateLabel) {
    elements.reportDateLabel.textContent = isCustom ? "From date" : "Base date";
  }
  elements.reportEndField?.classList.toggle("hidden", !isCustom);

  if (isCustom && elements.reportEndDate && !elements.reportEndDate.value) {
    elements.reportEndDate.value = elements.reportDate?.value || formatDateKey();
  }
};

const enableCustomDateRangeMode = () => {
  if (!elements.reportPeriod) {
    return;
  }

  if (elements.reportPeriod.value !== "custom") {
    elements.reportPeriod.value = "custom";
  }

  updateReportFilterVisibility();
  if (elements.reportEndDate && !elements.reportEndDate.value) {
    elements.reportEndDate.value = elements.reportDate?.value || formatDateKey();
  }
};

const renderReportRecords = (records = []) => {
  if (!elements.reportRecords || !elements.reportRowTemplate) {
    return;
  }

  elements.reportRecords.innerHTML = "";

  if (!records.length) {
    elements.reportRecords.innerHTML = '<p class="empty-state">No attendance records found for this range.</p>';
    return;
  }

  records.forEach((record) => {
    const fragment = elements.reportRowTemplate.content.cloneNode(true);
    fragment.querySelector(".report-date").textContent = formatReadableDate(record.attendanceDate);
    fragment.querySelector(".report-total").textContent = record.totalRecords;
    fragment.querySelector(".report-present").textContent = record.present;
    fragment.querySelector(".report-late").textContent = record.late;
    fragment.querySelector(".report-leave").textContent = record.leave;
    fragment.querySelector(".report-half-day").textContent = record.halfDay || 0;
    fragment.querySelector(".report-absent").textContent = record.absent;
    elements.reportRecords.appendChild(fragment);
  });
};

const renderDetailedReportRecords = (records = []) => {
  if (!elements.detailedReportRecords || !elements.detailedReportRowTemplate) {
    return;
  }

  elements.detailedReportRecords.innerHTML = "";

  const filteredRecords = filterDetailedRecords(records);
  updateDetailFilterChips();
  if (elements.detailVisibleCount) {
    elements.detailVisibleCount.textContent = `Showing ${filteredRecords.length} of ${records.length} rows`;
  }

  if (!filteredRecords.length) {
    elements.detailedReportRecords.innerHTML = '<p class="empty-state">No intern records found for this range.</p>';
    return;
  }

  filteredRecords.forEach((record) => {
    const fragment = elements.detailedReportRowTemplate.content.cloneNode(true);
    fragment.querySelector(".detail-intern-name").textContent = record.internName;
    fragment.querySelector(".detail-team").textContent = record.team;
    fragment.querySelector(".detail-date").textContent = formatReadableDate(record.attendanceDate);
    const morning = fragment.querySelector(".detail-morning");
    const evening = fragment.querySelector(".detail-evening");
    const final = fragment.querySelector(".detail-final");
    morning.textContent = record.morningStatus;
    evening.textContent = record.eveningStatus;
    final.textContent = record.finalStatus;
    morning.classList.add("status-badge", statusClassMap[record.morningStatus] || "status-absent");
    evening.classList.add("status-badge", statusClassMap[record.eveningStatus] || "status-absent");
    final.classList.add("status-badge", statusClassMap[record.finalStatus] || "status-absent");
    elements.detailedReportRecords.appendChild(fragment);
  });
};

const exportDetailedCsv = () => {
  const rows = filterDetailedRecords(state.detailedReportRecords);
  if (!rows.length) {
    setMessage(elements.formMessage, "No detailed records to export.", "error");
    return;
  }

  const csvRows = [
    ["Name", "Department", "Date", "Morning", "Evening", "Final Status"],
    ...rows.map((row) => [
      row.internName,
      row.team,
      row.attendanceDate,
      row.morningStatus,
      row.eveningStatus,
      row.finalStatus
    ])
  ];
  const csv = csvRows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
  }).join(",")).join("\r\n");
  const blob = new Blob([`${csv}\r\n`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `attendance-detailed-${formatDateKey()}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const loadAdminReport = async () => {
  if (!elements.reportPeriod || !elements.reportDate) {
    return;
  }

  const period = elements.reportPeriod.value;
  const rawDate = elements.reportDate.value || formatDateKey();
  let value = rawDate;

  if (period === "weekly") {
    value = rawDate;
  } else if (period === "monthly") {
    value = rawDate.slice(0, 7);
  } else if (period === "yearly") {
    value = rawDate.slice(0, 4);
  } else if (period === "custom") {
    const startDate = rawDate;
    const endDate = elements.reportEndDate?.value || startDate;
    value = `${startDate},${endDate}`;
  }

  const payload = await request(`/api/admin/reports/summary?period=${encodeURIComponent(period)}&value=${encodeURIComponent(value)}&session=${encodeURIComponent(state.attendanceSession)}`);
  elements.reportLabel.textContent = payload.label;
  elements.reportTotal.textContent = payload.summary.totalRecords;
  elements.reportPresent.textContent = payload.summary.present;
  elements.reportLate.textContent = payload.summary.late;
  elements.reportLeave.textContent = payload.summary.leave;
  elements.reportHalfDay.textContent = payload.summary.halfDay || 0;
  elements.reportAbsent.textContent = payload.summary.absent;
  elements.reportActiveInterns.textContent = payload.summary.activeInterns;
  renderReportRecords(payload.records);
  state.detailedReportRecords = payload.detailedRecords || [];
  renderDetailedReportRecords(state.detailedReportRecords);
};

const refreshRoleView = async () => {
  if (!state.user) {
    showView("auth");
    return;
  }

  if (state.user.role === "admin") {
    showView("admin");
    elements.sessionLabel.textContent = `${state.user.displayName} | ${state.user.username}`;
    await refreshAdminData();
    return;
  }

  logout();
};

const handleLogin = async (event) => {
  event.preventDefault();

  try {
    const payload = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: elements.loginUsername.value.trim(),
        password: elements.loginPassword.value
      })
    });

    state.token = payload.token;
    state.user = payload.user;
    saveSession();
    elements.loginForm.reset();
    setMessage(elements.loginMessage, "", "");
    await refreshRoleView();
  } catch (error) {
    setMessage(elements.loginMessage, error.message, "error");
  }
};

const logout = async () => {
  try {
    if (state.token) {
      await request("/api/auth/logout", {
        method: "POST"
      });
    }
  } catch {
    // Ignore logout failures and clear local session anyway.
  }

  state.token = "";
  state.user = null;
  state.interns = [];
  saveSession();
  showView("auth");
};

const resetPassword = async (event) => {
  event.preventDefault();

  try {
    await request("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({
        newPassword: elements.newPassword.value,
        verificationCode: elements.passwordCode.value
      })
    });

    elements.passwordForm.reset();
    setMessage(elements.passwordMessage, "Password reset. You can sign in now.", "success");
  } catch (error) {
    setMessage(elements.passwordMessage, error.message, "error");
  }
};

const showPasswordReset = () => {
  elements.loginForm.classList.add("hidden");
  elements.passwordResetView.classList.remove("hidden");
  setMessage(elements.loginMessage, "", "");
  if (state.passwordResetConfigured) {
    setMessage(elements.passwordMessage, "", "");
  }
  updatePasswordResetUi();
};

const showLoginForm = () => {
  elements.passwordResetView.classList.add("hidden");
  elements.loginForm.classList.remove("hidden");
  elements.passwordForm.reset();
  setMessage(elements.passwordMessage, "", "");
};

const sendPasswordCode = async () => {
  if (!state.passwordResetConfigured) {
    updatePasswordResetUi();
    return;
  }

  elements.sendPasswordCodeButton.disabled = true;
  elements.sendPasswordCodeButton.textContent = "Sending...";

  try {
    const payload = await request("/api/auth/password-reset-code", {
      method: "POST",
      body: JSON.stringify({})
    });
    setMessage(elements.passwordMessage, `Code sent to ${payload.email}. Check Inbox or Spam.`, "success");
  } catch (error) {
    setMessage(elements.passwordMessage, error.message, "error");
  } finally {
    elements.sendPasswordCodeButton.disabled = !state.passwordResetConfigured;
    elements.sendPasswordCodeButton.textContent = "Send code";
  }
};

const exportAttendanceCsv = async () => {
  try {
    const response = await fetch(`/api/admin/export-attendance?date=${encodeURIComponent(state.date)}&session=${state.attendanceSession}`, {
      headers: {
        Authorization: `Bearer ${state.token}`
      }
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "Export failed." }));
      throw new Error(payload.error || "Export failed.");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance-${state.date}-${state.attendanceSession}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage(elements.formMessage, `${getSessionLabel()} CSV exported.`, "success");
  } catch (error) {
    setMessage(elements.formMessage, error.message, "error");
  }
};

const addIntern = async (event) => {
  event.preventDefault();

  try {
    const payload = await request("/api/admin/interns", {
      method: "POST",
      body: JSON.stringify({
        name: elements.nameInput.value.trim(),
        team: elements.teamInput.value.trim()
      })
    });

    elements.form.reset();
    setMessage(elements.formMessage, `${payload.name} was added.`, "success");
    await refreshAdminData();
  } catch (error) {
    setMessage(elements.formMessage, error.message, "error");
  }
};

const saveAttendance = async () => {
  if (!state.pendingAttendance.size) {
    return;
  }

  const changes = Array.from(state.pendingAttendance, ([internId, status]) => ({ internId, status }));
  elements.saveAttendanceButton.disabled = true;
  elements.saveAttendanceButton.textContent = "Saving...";

  try {
    await Promise.all(changes.map((change) => request("/api/admin/attendance/status", {
      method: "POST",
      body: JSON.stringify({
        internId: change.internId,
        attendanceDate: state.date,
        attendanceSession: state.attendanceSession,
        status: change.status
      })
    })));

    state.pendingAttendance.clear();
    setMessage(elements.formMessage, `${getSessionLabel()} attendance saved.`, "success");
    await refreshAdminData();
  } catch (error) {
    setMessage(elements.formMessage, error.message, "error");
    setSaveButtonState();
  }
};

const undoDeletedIntern = async () => {
  if (!state.lastDeletedIntern) {
    return;
  }

  try {
    const restoredName = state.lastDeletedIntern.intern.name;
    await request("/api/admin/interns/restore", {
      method: "POST",
      body: JSON.stringify(state.lastDeletedIntern)
    });

    state.lastDeletedIntern = null;
    setUndoButtonState();
    setMessage(elements.formMessage, `${restoredName} was restored.`, "success");
    await refreshAdminData();
  } catch (error) {
    setMessage(elements.formMessage, error.message, "error");
  }
};

const removeIntern = async (internId, internName) => {
  const confirmed = window.confirm(`Remove ${internName}? This will also delete their saved attendance records.`);

  if (!confirmed) {
    return;
  }

  try {
    const payload = await request(`/api/admin/interns/${internId}`, {
      method: "DELETE"
    });

    state.lastDeletedIntern = payload.deletedIntern;
    setUndoButtonState();
    state.pendingAttendance.delete(internId);
    setMessage(elements.formMessage, `${internName} removed. Use Undo Remove to restore.`, "success");
    await refreshAdminData();
  } catch (error) {
    setMessage(elements.formMessage, error.message, "error");
  }
};

const resetToday = async () => {
  try {
    await request("/api/admin/attendance/reset-today", {
      method: "POST",
      body: JSON.stringify({
        attendanceDate: state.date,
        attendanceSession: state.attendanceSession
      })
    });

    state.pendingAttendance.clear();
    setMessage(elements.formMessage, `${getSessionLabel()} attendance was reset.`, "success");
    await refreshAdminData();
  } catch (error) {
    setMessage(elements.formMessage, error.message, "error");
  }
};

elements.loginForm.addEventListener("submit", handleLogin);
elements.logoutButton.addEventListener("click", logout);
elements.passwordForm.addEventListener("submit", resetPassword);
elements.showPasswordResetButton.addEventListener("click", showPasswordReset);
elements.backToLoginButton.addEventListener("click", showLoginForm);
elements.sendPasswordCodeButton.addEventListener("click", sendPasswordCode);
elements.form.addEventListener("submit", addIntern);
elements.searchInput.addEventListener("input", () => renderAdmin(state.summary));
elements.attendanceDate.addEventListener("change", loadSelectedAttendanceDate);
elements.attendanceSession.addEventListener("change", loadSelectedAttendanceSession);
elements.exportCsvButton.addEventListener("click", exportAttendanceCsv);
elements.saveAttendanceButton.addEventListener("click", saveAttendance);
elements.undoRemoveButton.addEventListener("click", undoDeletedIntern);
elements.resetDayButton?.addEventListener("click", resetToday);
elements.refreshReportButton?.addEventListener("click", loadAdminReport);
elements.reportPeriod?.addEventListener("change", () => {
  updateReportFilterVisibility();
  loadAdminReport();
});
elements.reportDate?.addEventListener("focus", enableCustomDateRangeMode);
elements.reportDate?.addEventListener("click", enableCustomDateRangeMode);
elements.reportDate?.addEventListener("change", () => {
  if (elements.reportPeriod?.value === "custom" && elements.reportEndDate) {
    elements.reportEndDate.value = elements.reportEndDate.value || elements.reportDate.value || formatDateKey();
  }
  loadAdminReport();
});
elements.reportEndDate?.addEventListener("change", loadAdminReport);
elements.detailStatusFilter?.addEventListener("change", () => renderDetailedReportRecords(state.detailedReportRecords));
elements.detailNameFilter?.addEventListener("input", () => renderDetailedReportRecords(state.detailedReportRecords));
elements.detailDepartmentFilter?.addEventListener("input", () => renderDetailedReportRecords(state.detailedReportRecords));
elements.detailSortBy?.addEventListener("change", () => renderDetailedReportRecords(state.detailedReportRecords));
elements.clearDetailedFiltersButton?.addEventListener("click", () => {
  resetDetailedFilters();
  renderDetailedReportRecords(state.detailedReportRecords);
});
elements.exportDetailedCsvButton?.addEventListener("click", exportDetailedCsv);
document.querySelectorAll("[data-password-toggle]").forEach((button) => {
  button.addEventListener("click", () => togglePasswordVisibility(button));
});
window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    undoDeletedIntern();
  }
}, true);

elements.attendanceDate.value = state.date;
setAttendanceDateState(state.date, { preserveManualSession: false });
updateReportFilterVisibility();
if (elements.reportPeriod && elements.reportDate) {
  elements.reportPeriod.addEventListener("change", () => {
    if (elements.reportPeriod.value === "custom") {
      elements.reportDate.focus();
    }
  });
}
window.setInterval(() => {
  if (!state.user || state.user.role !== "admin") {
    return;
  }

  if (syncAttendanceSessionWithTime()) {
    state.pendingAttendance.clear();
    refreshAdminData().catch(() => {});
  }
}, 60000);
loadSession();

loadPasswordResetStatus().finally(() => {
  if (!state.token || !state.user) {
    showView("auth");
  } else {
    request("/api/auth/me")
      .then((payload) => {
        state.user = payload.user;
        saveSession();
        return refreshRoleView();
      })
      .catch(() => {
        logout();
      });
  }
});
