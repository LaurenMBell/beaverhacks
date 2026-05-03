// Import the functions you need from the SDKs you need
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAoCtWhxyi2BSZlqyANDDAqYAnYOPaOqk8",
  authDomain: "beaverhacks-1f94b.firebaseapp.com",
  projectId: "beaverhacks-1f94b",
  storageBucket: "beaverhacks-1f94b.firebasestorage.app",
  messagingSenderId: "748784037540",
  appId: "1:748784037540:web:334443dfd62ecdccadc031",
  measurementId: "G-13LRX3QF91"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

