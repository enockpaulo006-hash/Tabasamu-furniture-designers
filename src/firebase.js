
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBxmyRUMwinWWXDii5g4wMPnIOzGiG2B14",
  authDomain: "tabasamu-furniture-designers.firebaseapp.com",
  projectId: "tabasamu-furniture-designers",
  storageBucket: "tabasamu-furniture-designers.firebasestorage.app",
  messagingSenderId: "397473747445",
  appId: "1:397473747445:web:97f8be1e6f9b3c030010bc",
  measurementId: "G-119WY0YD6G"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
