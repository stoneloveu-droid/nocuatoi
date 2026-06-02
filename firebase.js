import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ⚠️  BẢO MẬT: Sau khi deploy, vào Firebase Console:
//   1. Project Settings > API key > HTTP referrers → chỉ cho phép domain của bạn
//   2. Firestore Security Rules:
//      rules_version = '2';
//      service cloud.firestore {
//        match /databases/{database}/documents {
//          match /users/{uid} { allow read, write: if request.auth != null && request.auth.uid == uid; }
//        }
//      }
const firebaseConfig = {
  apiKey: "AIzaSyA1Pde18_aLXilbvs1Q0fWbVtcApkAdJcs",
  authDomain: "vicuatoi.firebaseapp.com",
  projectId: "vicuatoi",
  storageBucket: "vicuatoi.firebasestorage.app",
  messagingSenderId: "490747827741",
  appId: "1:490747827741:web:ea97898cec463d3d6f18f4"
};

const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
const db    = getFirestore(fbApp);

export { auth, db, doc, onSnapshot, setDoc, GoogleAuthProvider, signInWithPopup, signInAnonymously, onAuthStateChanged, signOut };
