# ESP1.ORG

Personlig nettside for Espen Fiskebeck.
Bygget med Vite + Firebase + GitHub Pages.

## Kom i gang

### 1. Klon og installer
```bash
git clone https://github.com/efiskebeck/esp1org.git
cd esp1org
npm install
```

### 2. Firebase-oppsett
1. Gå til [Firebase Console](https://console.firebase.google.com)
2. Opprett nytt prosjekt: `esp1org`
3. Aktiver **Firestore Database** (production mode)
4. Aktiver **Authentication** → Email/Password
5. Aktiver **Storage**
6. Legg til en web-app, kopier config-verdiene

### 3. Miljøvariabler
```bash
cp .env.example .env.local
# Fyll inn Firebase-verdiene dine
```

### 4. Firestore-regler
I Firebase Console → Firestore → Rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /articles/{id} {
      allow read: if resource.data.published == true;
      allow write: if request.auth != null;
      match /comments/{c} {
        allow read: if true;
        allow create: if true;
        allow update, delete: if request.auth != null;
      }
    }
  }
}
```

### 5. Lokal utvikling
```bash
npm run dev
# → http://localhost:5173
```

### 6. Importer WordPress-artikler
```bash
pip install firebase-admin
# Last ned serviceAccountKey.json fra Firebase Console
python3 import_wordpress.py
```

### 7. Deploy til GitHub Pages
1. Push til GitHub
2. GitHub → Settings → Pages → Source: GitHub Actions
3. Legg til secrets under Settings → Secrets → Actions:
   - `FIREBASE_API_KEY`
   - `FIREBASE_AUTH_DOMAIN`
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_STORAGE_BUCKET`
   - `FIREBASE_MESSAGING_SENDER_ID`
   - `FIREBASE_APP_ID`
4. Push til `main` → automatisk deploy

## Struktur
```
esp1org/
├── index.html          ← Offentlig side
├── admin.html          ← Admin-panel (Firebase Auth-beskyttet)
├── src/
│   ├── firebase.js     ← Firebase config
│   ├── main.js         ← Offentlig side logikk
│   ├── admin.js        ← Admin logikk
│   ├── style.css       ← Designsystem
│   └── admin.css       ← Admin-spesifikk CSS
├── import_wordpress.py ← WP XML → Firestore
├── .env.example
└── .github/workflows/deploy.yml
```
