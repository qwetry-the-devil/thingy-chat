// --- REPLACE THE CONFIG BELOW WITH YOUR FIREBASE CONFIG ---
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAzDG_Yx_VP9GRVEP3L9DNjME9f_8G6Prg",
  authDomain: "thingy-chat.firebaseapp.com",
  projectId: "thingy-chat",
  storageBucket: "thingy-chat.firebasestorage.app",
  messagingSenderId: "871089190686",
  appId: "1:871089190686:web:04269ffbd1deccbdd7bb0f"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
  // optional fields:
  // storageBucket, messagingSenderId, appId
};
// ----------------------------------------------------------

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// DOM refs
const authSection = document.getElementById('authSection');
const mainUI = document.getElementById('mainUI');
const userLabel = document.getElementById('userLabel');
const signOutBtn = document.getElementById('signOutBtn');

const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const signupBtn = document.getElementById('signupBtn');
const signinBtn = document.getElementById('signinBtn');
const anonBtn = document.getElementById('anonBtn');
const authMsg = document.getElementById('authMsg');

const friendEmail = document.getElementById('friendEmail');
const sendFriendReqBtn = document.getElementById('sendFriendReqBtn');
const friendRequestsList = document.getElementById('friendRequestsList');
const friendsList = document.getElementById('friendsList');
const roomMembersSelect = document.getElementById('roomMembersSelect');
const createRoomBtn = document.getElementById('createRoomBtn');
const roomsList = document.getElementById('roomsList');

const messagesDiv = document.getElementById('messages');
const msgInput = document.getElementById('msgInput');
const sendMsgBtn = document.getElementById('sendMsgBtn');
const activeRoomTitle = document.getElementById('activeRoomTitle');

let currentUser = null;
let activeRoomId = 'global'; // default global chat
let unsubscribeListeners = [];

function showMsg(el, text, isError=false){
  el.textContent = text;
  el.style.color = isError ? 'crimson' : '';
  setTimeout(()=> el.textContent = '', 4000);
}

signupBtn.onclick = async () => {
  try {
    const email = emailInput.value.trim();
    const pw = passwordInput.value;
    if(!email || !pw) return showMsg(authMsg,'enter email and password',true);
    const cred = await auth.createUserWithEmailAndPassword(email, pw);
    await db.collection('users').doc(cred.user.uid).set({email, createdAt: firebase.firestore.FieldValue.serverTimestamp(), displayName: email.split('@')[0] }, {merge:true});
  } catch(e){ showMsg(authMsg, e.message, true) }
};

signinBtn.onclick = async () => {
  try {
    const email = emailInput.value.trim();
    const pw = passwordInput.value;
    await auth.signInWithEmailAndPassword(email, pw);
  } catch(e){ showMsg(authMsg, e.message, true) }
};

anonBtn.onclick = async () => {
  try {
    const cred = await auth.signInAnonymously();
    // create a minimal profile doc for anonymous user
    await db.collection('users').doc(cred.user.uid).set({displayName:'anon-'+cred.user.uid.slice(0,6), anonymous:true, createdAt: firebase.firestore.FieldValue.serverTimestamp()}, {merge:true});
  } catch(e){ showMsg(authMsg, e.message, true) }
};

signOutBtn.onclick = () => auth.signOut();

auth.onAuthStateChanged(async user => {
  // cleanup previous listeners
  unsubscribeListeners.forEach(u => u && u());
  unsubscribeListeners = [];

  if(!user){
    currentUser = null;
    userLabel.textContent = 'Not signed in';
    signOutBtn.style.display = 'none';
    authSection.style.display = '';
    mainUI.style.display = 'none';
    activeRoomId = 'global';
    messagesDiv.innerHTML = '';
    return;
  }
  currentUser = user;
  userLabel.textContent = (user.email || ('anon-'+user.uid.slice(0,6)));
  signOutBtn.style.display = '';
  authSection.style.display = 'none';
  mainUI.style.display = '';

  // ensure user doc exists
  const uref = db.collection('users').doc(user.uid);
  await uref.set({lastSeen: firebase.firestore.FieldValue.serverTimestamp()}, {merge:true});

  // set up friend lists and room lists
  setupFriendListeners();
  setupRoomsListener();
  joinRoom('global'); // default global chat
});

function setupFriendListeners(){
  const uid = currentUser.uid;
  const usersCol = db.collection('users');

  // incoming friend requests where toId == me
  const frReqsQuery = db.collection('friendRequests').where('to','==',uid);
  const unsubFR = frReqsQuery.onSnapshot(snap => {
    friendRequestsList.innerHTML = '';
    snap.forEach(doc => {
      const r = doc.data();
      const li = document.createElement('li');
      li.textContent = r.fromEmail || r.from;
      const acceptBtn = document.createElement('button');
      acceptBtn.textContent = 'Accept';
      acceptBtn.onclick = async () => {
        // create friendship both ways
        const batch = db.batch();
        batch.set(db.collection('friends').doc(uid+'_'+r.from),'',{uid,friendId:r.from,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
        batch.set(db.collection('friends').doc(r.from+'_'+uid),'',{uid:r.from,friendId:uid,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
        batch.delete(doc.ref);
        await batch.commit();
      };
      const denyBtn = document.createElement('button');
      denyBtn.textContent = 'Deny';
      denyBtn.onclick = () => doc.ref.delete();
      li.appendChild(acceptBtn);
      li.appendChild(denyBtn);
      friendRequestsList.appendChild(li);
    });
  });
  unsubscribeListeners.push(unsubFR);

  // friends list: query friend docs where uid == me
  const friendsQuery = db.collection('friends').where('uid','==',uid);
  const unsubFriends = friendsQuery.onSnapshot(async snap => {
    friendsList.innerHTML = '';
    roomMembersSelect.innerHTML = '';
    const ids = [];
    for(const d of snap.docs){
      const data = d.data();
      ids.push(data.friendId);
    }
    if(ids.length===0){
      friendsList.innerHTML = '<li class="muted">No friends yet</li>';
    } else {
      // fetch friend profiles
      const profPromises = ids.map(i => db.collection('users').doc(i).get());
      const profDocs = await Promise.all(profPromises);
      profDocs.forEach(pd => {
        const p = pd.data();
        const li = document.createElement('li');
        li.textContent = p?.email || p?.displayName || ('user-'+pd.id.slice(0,6));
        const chatBtn = document.createElement('button');
        chatBtn.textContent = 'Chat';
        chatBtn.onclick = () => createOrOpenPrivateRoomWith(pd.id, p);
        li.appendChild(chatBtn);
        friendsList.appendChild(li);

        // add to room members select
        const opt = document.createElement('option');
        opt.value = pd.id;
        opt.text = p?.email || p?.displayName || pd.id;
        roomMembersSelect.appendChild(opt);
      });
    }
  });
  unsubscribeListeners.push(unsubFriends);
}

sendFriendReqBtn.onclick = async () => {
  const email = friendEmail.value.trim();
  if(!email) return;
  // find user by email
  const q = await db.collection('users').where('email','==',email).get();
  if(q.empty){ return showMsg(authMsg,'No user with that email found', true); }
  const target = q.docs[0];
  // create request doc (from me -> them)
  await db.collection('friendRequests').add({
    from: currentUser.uid,
    fromEmail: currentUser.email || ('anon-'+currentUser.uid.slice(0,6)),
    to: target.id,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  showMsg(authMsg,'Friend request sent');
};

createRoomBtn.onclick = async () => {
  const name = document.getElementById('roomName').value.trim();
  const selected = Array.from(roomMembersSelect.selectedOptions).map(o=>o.value);
  if(!name || selected.length===0) return showMsg(authMsg,'Enter name and pick at least one friend', true);
  // create a room doc
  const room = {
    name,
    isPrivate: true,
    members: [...selected, currentUser.uid],
    createdBy: currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  const rref = await db.collection('rooms').add(room);
  showMsg(authMsg,'Room created');
};

async function createOrOpenPrivateRoomWith(friendId, friendProfile){
  // Try to find an existing 1:1 room with exactly these two members
  const q = await db.collection('rooms')
    .where('isPrivate','==',true)
    .where('members','array-contains', currentUser.uid)
    .get();
  for(const d of q.docs){
    const m = d.data().members || [];
    if(m.length===2 && m.includes(friendId) && m.includes(currentUser.uid)){
      joinRoom(d.id);
      return;
    }
  }
  // create new 1:1 room
  const r = await db.collection('rooms').add({
    name: friendProfile?.displayName || friendProfile?.email || 'Private chat',
    isPrivate: true,
    members: [currentUser.uid, friendId],
    createdBy: currentUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  joinRoom(r.id);
}

function setupRoomsListener(){
  const uid = currentUser.uid;
  // listen to all public rooms and private rooms that include me
  const roomsQuery = db.collection('rooms')
    .where('members', 'array-contains', uid); // this will show private rooms containing me
  const unsub = roomsQuery.onSnapshot(snap => {
    roomsList.innerHTML = '';
    snap.forEach(doc => {
      const r = doc.data();
      const li = document.createElement('li');
      li.textContent = (r.name || 'Room') + (r.isPrivate ? ' (private)' : '');
      li.onclick = () => joinRoom(doc.id, r.name);
      roomsList.appendChild(li);
    });
  });
  unsubscribeListeners.push(unsub);

  // also ensure there's a global room doc for metadata (optional)
  db.collection('rooms').doc('global').set({name:'Global Chat', isPrivate:false, members:[], createdAt: firebase.firestore.FieldValue.serverTimestamp()}, {merge:true});
}

async function joinRoom(roomId, roomName){
  // cleanup
  unsubscribeListeners.forEach(u => u && u());
  unsubscribeListeners = [];

  activeRoomId = roomId;
  activeRoomTitle.textContent = roomName || (roomId === 'global' ? 'Global Chat' : 'Room');
  messagesDiv.innerHTML = '';

  // setup message listener
  const msgsRef = (roomId === 'global') ? db.collection('globalMessages').orderBy('createdAt') : db.collection('rooms').doc(roomId).collection('messages').orderBy('createdAt');
  const unsubMsgs = msgsRef.onSnapshot(snap => {
    messagesDiv.innerHTML = '';
    snap.forEach(d => {
      const m = d.data();
      const el = document.createElement('div');
      el.className = 'message ' + (m.uid === currentUser.uid ? 'me' : 'other');
      el.innerHTML = `<div><strong>${m.displayName || m.uid.slice(0,6)}</strong></div><div>${escapeHtml(m.text)}</div><div class="small muted">${new Date(m.createdAt?.toDate?.() || Date.now()).toLocaleString()}</div>`;
      messagesDiv.appendChild(el);
    });
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  });
  unsubscribeListeners.push(unsubMsgs);
}

sendMsgBtn.onclick = async () => {
  const text = msgInput.value.trim();
  if(!text) return;
  const payload = {
    text,
    uid: currentUser.uid,
    displayName: currentUser.email || ('anon-'+currentUser.uid.slice(0,6)),
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  if(activeRoomId === 'global'){
    await db.collection('globalMessages').add(payload);
  } else {
    const roomRef = db.collection('rooms').doc(activeRoomId);
    // check membership is enforced by security rules; here we assume client is allowed
    await roomRef.collection('messages').add(payload);
  }
  msgInput.value = '';
};

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
