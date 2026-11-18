# SUK Bingo: come metterlo online

L'app è un sito statico (una pagina, niente server da gestire). Login e dati in tempo reale sono gestiti da **Firebase**, gratis per un uso tra amici. Servono due cose: un progetto Firebase e un posto dove pubblicare i file.

## 1. Crea il progetto Firebase (circa 5 minuti)

1. Vai su https://console.firebase.google.com e accedi con il tuo account Google.
2. **Aggiungi progetto**, chiamalo per esempio `suk-bingo`. Google Analytics puoi disattivarlo.
3. **Authentication** → *Inizia* → scheda *Metodo di accesso*:
   - attiva **Google** (scegli la tua email come email di assistenza);
   - attiva **Email/password**.
4. **Firestore Database** → *Crea database* → posizione `eur3 (europe-west)` → avvia in **modalità produzione**.
5. Sempre in Firestore, scheda **Regole**: cancella tutto, incolla il contenuto del file `firestore.rules` e premi **Pubblica**.
6. **Impostazioni progetto** (ingranaggio) → *Le tue app* → icona **Web `</>`** → dai un nome e registra. Copia i valori di `firebaseConfig` dentro `config.js`.

## 2. Pubblica il sito

### Opzione A: Firebase Hosting (consigliata, il login Google funziona subito)
Da un computer con Node.js installato, nella cartella dell'app:
```
npm install -g firebase-tools
firebase login
firebase use --add        (scegli il progetto suk-bingo)
firebase deploy
```
Il sito sarà su `https://<nome-progetto>.web.app`.

### Opzione B: GitHub Pages
1. Crea un repository su GitHub e carica tutti i file di questa cartella.
2. *Settings* → *Pages* → Branch `main`, cartella `/ (root)` → *Save*.
3. In Firebase: **Authentication → Impostazioni → Domini autorizzati** → aggiungi `<tuo-utente>.github.io`.

## 3. Gioca
- Apri il sito, accedi, crea un tabellone e premi **Invita**: il link porta gli amici direttamente al tabellone.
- Gli amici accedono con Google o con email e password, senza nient'altro da installare.
- Sul telefono: menu del browser → **Aggiungi a schermata Home** (Android: *Installa app*). Si apre a schermo intero come un'app.

## Come funziona la privacy
- Solo chi ha fatto l'accesso **e** ha il link può aprire un tabellone.
- Nella home ognuno vede solo i tabelloni creati da lui o a cui è entrato.
- Ognuno può segnare o togliere solo le proprie caselle. Solo il creatore può modificare o eliminare il tabellone.
