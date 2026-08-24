// 직원 로그인/회원가입 게이트 — Firebase Authentication + Firestore 사용.
// 회원가입하면 Firestore employees/{uid} 문서가 status:"pending" 으로 생성되고,
// 관리자(ADMIN_UID)가 승인해야 status:"approved" 로 바뀌어 로그인이 가능해집니다.
//
// 관리자 지정 방법: 관리자 계정으로 먼저 회원가입 → Firebase 콘솔(Authentication)에서
// 해당 계정의 UID를 복사 → 아래 ADMIN_UID 값에 붙여넣기 → Firestore에서 그 문서의
// status를 approved로 직접 수정 (최초 1회만 콘솔에서 수동으로 승인해야 합니다).
const ADMIN_UID = "cl5X9kBKolYSJferSoU00CIKvHB3";

firebase.initializeApp(window.firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

function idToEmail(id) {
  return id.trim().toLowerCase() + "@barle.local";
}

const AUTH_ERROR_MESSAGES = {
  "auth/email-already-in-use": "이미 사용 중인 아이디입니다.",
  "auth/weak-password": "비밀번호는 6자 이상이어야 합니다.",
  "auth/invalid-email": "아이디에 사용할 수 없는 문자가 포함되어 있습니다.",
  "auth/user-not-found": "아이디 또는 비밀번호가 올바르지 않습니다.",
  "auth/wrong-password": "아이디 또는 비밀번호가 올바르지 않습니다.",
  "auth/invalid-credential": "아이디 또는 비밀번호가 올바르지 않습니다.",
  "auth/too-many-requests": "너무 많이 시도했습니다. 잠시 후 다시 시도해주세요.",
};

function authErrorMessage(error) {
  return AUTH_ERROR_MESSAGES[error.code] || "오류가 발생했습니다: " + error.message;
}

let employeeDocUnsub = null;
let pendingListUnsub = null;

function els() {
  return {
    overlay: document.getElementById("login-overlay"),
    tabs: document.getElementById("login-tabs"),
    viewLogin: document.getElementById("auth-view-login"),
    viewSignup: document.getElementById("auth-view-signup"),
    viewPending: document.getElementById("auth-view-pending"),
    loginForm: document.getElementById("login-form"),
    loginError: document.getElementById("login-error"),
    signupForm: document.getElementById("signup-form"),
    signupError: document.getElementById("signup-error"),
  };
}

function setMode(mode) {
  const { viewLogin, viewSignup, viewPending, tabs } = els();
  viewLogin.hidden = mode !== "login";
  viewSignup.hidden = mode !== "signup";
  viewPending.hidden = mode !== "pending";
  if (tabs) {
    tabs.hidden = mode === "pending";
    tabs.querySelectorAll(".login-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
  }
}

function showLogin() {
  document.body.classList.remove("authed");
  els().overlay.hidden = false;
  setMode("login");
}

function showPending() {
  document.body.classList.remove("authed");
  els().overlay.hidden = false;
  setMode("pending");
}

function showApp(profile) {
  document.body.classList.add("authed");
  els().overlay.hidden = true;
  document.getElementById("current-employee-name").textContent = profile.name || profile.id;
  document.getElementById("current-employee-position").textContent = profile.position || "";
  document.getElementById("btn-open-approval").hidden = auth.currentUser?.uid !== ADMIN_UID;
}

function setupTabs() {
  document.getElementById("login-tabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".login-tab");
    if (!btn) return;
    els().loginError.hidden = true;
    els().signupError.hidden = true;
    setMode(btn.dataset.mode);
  });
}

function setupLoginForm() {
  const form = els().loginForm;
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = els().loginError;
    errorEl.hidden = true;
    const id = form.elements.employeeId.value.trim();
    const password = form.elements.password.value;
    try {
      await auth.signInWithEmailAndPassword(idToEmail(id), password);
      form.reset();
    } catch (error) {
      errorEl.textContent = authErrorMessage(error);
      errorEl.hidden = false;
      form.elements.password.value = "";
    }
  });
}

function setupSignupForm() {
  const form = els().signupForm;
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = els().signupError;
    errorEl.hidden = true;
    const id = form.elements.employeeId.value.trim();
    const password = form.elements.password.value;
    const name = form.elements.name.value.trim();
    const position = form.elements.position.value.trim();

    if (!id || !password || !name || !position) return;

    try {
      const cred = await auth.createUserWithEmailAndPassword(idToEmail(id), password);
      await db.collection("employees").doc(cred.user.uid).set({
        id,
        name,
        position,
        status: "pending",
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await auth.signOut();
      form.reset();
      setMode("login");
      const loginError = els().loginError;
      loginError.textContent = "가입 신청이 완료되었습니다. 관리자 승인 후 로그인해주세요.";
      loginError.classList.add("login-success");
      loginError.hidden = false;
    } catch (error) {
      errorEl.textContent = authErrorMessage(error);
      errorEl.hidden = false;
    }
  });
}

function setupLogout() {
  const doLogout = () => auth.signOut();
  document.getElementById("btn-logout")?.addEventListener("click", doLogout);
  document.getElementById("btn-pending-logout")?.addEventListener("click", doLogout);
}

function setupPasswordChange() {
  const overlay = document.getElementById("password-overlay");
  const form = document.getElementById("password-form");
  const errorEl = document.getElementById("password-error");
  if (!overlay || !form) return;

  const closeModal = () => {
    overlay.hidden = true;
    form.reset();
    errorEl.hidden = true;
    errorEl.classList.remove("login-success");
  };

  document.getElementById("btn-open-password")?.addEventListener("click", () => {
    overlay.hidden = false;
  });
  document.getElementById("password-cancel")?.addEventListener("click", closeModal);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    errorEl.classList.remove("login-success");

    const currentPassword = form.elements.currentPassword.value;
    const newPassword = form.elements.newPassword.value;
    const confirmPassword = form.elements.confirmPassword.value;

    if (newPassword !== confirmPassword) {
      errorEl.textContent = "새 비밀번호가 일치하지 않습니다.";
      errorEl.hidden = false;
      return;
    }

    try {
      const user = auth.currentUser;
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(newPassword);
      errorEl.textContent = "비밀번호가 변경되었습니다.";
      errorEl.classList.add("login-success");
      errorEl.hidden = false;
      form.reset();
      setTimeout(closeModal, 1200);
    } catch (error) {
      errorEl.textContent =
        error.code === "auth/wrong-password" || error.code === "auth/invalid-credential"
          ? "현재 비밀번호가 올바르지 않습니다."
          : authErrorMessage(error);
      errorEl.hidden = false;
    }
  });
}

function renderApprovalItem(docSnap) {
  const data = docSnap.data();
  const item = document.createElement("div");
  item.className = "approval-item";
  item.innerHTML = `
    <div class="approval-item-info">
      <strong>${data.name}</strong>
      <span>${data.position} · ${data.id}</span>
    </div>
    <div class="approval-item-actions">
      <button type="button" class="btn btn-secondary approval-reject">거절</button>
      <button type="button" class="btn btn-primary approval-approve">승인</button>
    </div>
  `;
  item.querySelector(".approval-approve").addEventListener("click", async () => {
    await db.collection("employees").doc(docSnap.id).update({ status: "approved" });
  });
  item.querySelector(".approval-reject").addEventListener("click", async () => {
    await db.collection("employees").doc(docSnap.id).update({ status: "rejected" });
  });
  return item;
}

function setupApprovalPanel() {
  const overlay = document.getElementById("approval-overlay");
  const list = document.getElementById("approval-list");

  document.getElementById("btn-open-approval")?.addEventListener("click", () => {
    overlay.hidden = false;
    pendingListUnsub = db
      .collection("employees")
      .where("status", "==", "pending")
      .onSnapshot((snapshot) => {
        list.innerHTML = "";
        if (snapshot.empty) {
          list.innerHTML = '<p class="approval-empty">승인 대기중인 가입 신청이 없습니다.</p>';
          return;
        }
        snapshot.forEach((docSnap) => list.appendChild(renderApprovalItem(docSnap)));
      });
  });

  document.getElementById("approval-close")?.addEventListener("click", () => {
    overlay.hidden = true;
    if (pendingListUnsub) {
      pendingListUnsub();
      pendingListUnsub = null;
    }
  });
}

function initAuth() {
  setupTabs();
  setupLoginForm();
  setupSignupForm();
  setupLogout();
  setupApprovalPanel();
  setupPasswordChange();

  auth.onAuthStateChanged((user) => {
    if (employeeDocUnsub) {
      employeeDocUnsub();
      employeeDocUnsub = null;
    }

    if (!user) {
      showLogin();
      return;
    }

    employeeDocUnsub = db
      .collection("employees")
      .doc(user.uid)
      .onSnapshot((docSnap) => {
        if (!docSnap.exists) {
          showLogin();
          auth.signOut();
          return;
        }
        const data = docSnap.data();
        if (data.status === "approved") {
          showApp(data);
        } else if (data.status === "pending") {
          showPending();
        } else {
          showLogin();
          const loginError = els().loginError;
          loginError.textContent = "가입이 거절된 계정입니다. 관리자에게 문의해주세요.";
          loginError.hidden = false;
          auth.signOut();
        }
      });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuth);
} else {
  initAuth();
}
