import core from './sync.js';
import {initializeApp} from 'firebase/app';
import {getAuth,GoogleAuthProvider,signInWithPopup,signOut,onAuthStateChanged} from 'firebase/auth';
import {getFirestore,doc,collection,query,orderBy,documentId,startAfter,limit,getDocFromServer,getDocsFromServer,runTransaction,serverTimestamp} from 'firebase/firestore';
import {createFirebaseRequest,firebaseAccount} from './firebase-sync-core.mjs';

let auth,db;
const listeners=new Set();
const info=()=>({account:auth?.currentUser?firebaseAccount(auth.currentUser.uid):null,
 user:auth?.currentUser?{name:auth.currentUser.displayName||'',email:auth.currentUser.email||''}:null,
 provider:auth?.currentUser?'google':null,googleEnabled:true,hasLegacyAccount:false});
const initialized=(async()=>{
 const response=await fetch('/__/firebase/init.json',{cache:'no-store'});
 if(!response.ok)throw Error('firebase_not_configured');
 const config=await response.json();
 if(!config.apiKey||!config.authDomain||!config.projectId)throw Error('firebase_not_configured');
 const app=initializeApp(config);auth=getAuth(app);db=getFirestore(app);
 await new Promise((resolve,reject)=>{
  let first=true;
  onAuthStateChanged(auth,()=>{if(first){first=false;resolve();return;}for(const listener of listeners)listener(info());},reject);
 });
})();
// Initialization failure is surfaced by ready()/request; do not leave an unhandled rejection.
initialized.catch(()=>{});
window.YeoFirebaseAuth={
 ready:async()=>{await initialized;return info();},
 signIn:async()=>{await initialized;const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await signInWithPopup(auth,provider);},
 signOut:async()=>{await initialized;await signOut(auth);},
 onChange(listener){listeners.add(listener);void initialized.then(()=>listener(info())).catch(()=>{});return ()=>listeners.delete(listener);}
};
const request=createFirebaseRequest({
 ready:()=>initialized,getUser:()=>auth?.currentUser,
 read:async(uid,id)=>{const result=await getDocFromServer(doc(db,'users',uid,'records',id));return result.exists()?result.data():null;},
 list:async(uid,after,count)=>{
  const constraints=[orderBy(documentId()),...(after?[startAfter(after)]:[]),limit(count)];
  const result=await getDocsFromServer(query(collection(db,'users',uid,'records'),...constraints));
  return result.docs.map(item=>({id:item.id,...item.data()}));
 },
 compareAndSet:async(uid,id,baseRevision,stateJSON,unchanged)=>runTransaction(db,async tx=>{
  unchanged();const reference=doc(db,'users',uid,'records',id),snapshot=await tx.get(reference);unchanged();
  const revision=snapshot.exists()?snapshot.data().revision:0;
  if(revision!==baseRevision)return {conflict:true,revision};
  tx.set(reference,{formatVersion:2,revision:revision+1,updatedAt:serverTimestamp(),stateJSON});
  return {revision:revision+1};
 })
});
window.YeoSync={create:options=>core.create({...options,request})};
