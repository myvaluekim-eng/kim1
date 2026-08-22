// 직원 로그인 게이트 — 백엔드 서버가 없는 정적 사이트라 클라이언트에서 비밀번호를 확인합니다.
// 새 직원을 추가/변경하려면: 브라우저 콘솔에서 authHash("비밀번호") 실행 후 나온 값을 passHash에 넣으세요.
// 주의: 실제 비밀번호는 절대 이 파일에 평문으로 적지 마세요 (공개 저장소에 그대로 노출됩니다).
const EMPLOYEES = [
  { id: "admin", name: "관리자", passHash: "38fdc8a2033bbd878fa5cea6bc0e1c8e4cd09017821efbda0c70a50340e9160c" },
];

const AUTH_SESSION_KEY = "barle-auth-session";

async function authHash(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
window.authHash = authHash;

function getSession() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    const employee = EMPLOYEES.find((e) => e.id === session.id);
    if (!employee || employee.passHash !== session.passHash) return null;
    return employee;
  } catch (_) {
    return null;
  }
}

function setSession(employee) {
  localStorage.setItem(
    AUTH_SESSION_KEY,
    JSON.stringify({ id: employee.id, passHash: employee.passHash })
  );
}

function clearSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
}

function showApp(employee) {
  document.body.classList.add("authed");
  const overlay = document.getElementById("login-overlay");
  if (overlay) overlay.hidden = true;
  const label = document.getElementById("current-employee-name");
  if (label) label.textContent = employee.name || employee.id;
}

function showLogin() {
  document.body.classList.remove("authed");
  const overlay = document.getElementById("login-overlay");
  if (overlay) overlay.hidden = false;
  document.getElementById("login-id")?.focus();
}

function setupLoginForm() {
  const form = document.getElementById("login-form");
  if (!form) return;
  const errorEl = document.getElementById("login-error");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const id = form.elements.employeeId.value.trim();
    const password = form.elements.password.value;
    const employee = EMPLOYEES.find((emp) => emp.id === id);
    const hash = await authHash(password);

    if (employee && employee.passHash === hash) {
      setSession(employee);
      form.reset();
      showApp(employee);
    } else {
      errorEl.textContent = "아이디 또는 비밀번호가 올바르지 않습니다.";
      errorEl.hidden = false;
      form.elements.password.value = "";
      form.elements.password.focus();
    }
  });

  document.getElementById("btn-logout")?.addEventListener("click", () => {
    clearSession();
    showLogin();
  });
}

function initAuth() {
  setupLoginForm();
  const employee = getSession();
  if (employee) {
    showApp(employee);
  } else {
    showLogin();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuth);
} else {
  initAuth();
}
