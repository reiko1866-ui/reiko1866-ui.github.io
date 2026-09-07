# Ketten

Expo (React Native) app, amivel ketten kölcsönösen látjátok egymás élő helyzetét a térképen.

A helyzet egy saját, kicsi relé-szerveren keresztül megy: csak az a két eszköz látja, akik ugyanazzal a 6 karakteres párkóddal csatlakoztak.

## Mit tud

- Pár létrehozása / csatlakozás kóddal
- Élő térkép, távolság, utolsó frissítés
- Megosztás ki/be kapcsolása
- Próba mód egyedül (szerver nélkül)
- Előtérben működik Expo Go-val; háttérbeli követéshez később development build kell

## Telefonon kipróbálás

A relé a webes appot is kiszolgálja. Indítsd:

```bash
cd ketten
npm install
npm run relay
```

Nyisd meg a telefonon: `http://<a-géped-LAN-IP-je>:8787`

Távolról (HTTPS kell a GPS-hez) tedd ki alagúttal, például:

```bash
cloudflared tunnel --url http://127.0.0.1:8787
```

A kapott `https://…trycloudflare.com` címet nyissátok meg mindkét telefonon. Az egyik **Pár létrehozása**, a másik a kóddal csatlakozik.

## Gyors indítás Expo Go-val (ugyanazon a Wi-Fi-n)

Két terminál:

```bash
cd ketten
npm install
npm run relay
```

```bash
cd ketten
npx expo start
```

A telefonokon nyisd meg az **Expo Go** appot, olvasd be a QR-kódot.

1. Add meg a neved.
2. Az egyikőtök: **Pár létrehozása** — küldd el a kódot.
3. A másik: **Csatlakozás** a kóddal.
4. Engedélyezzétek a helymeghatározást.

A relé címe alapból a gép LAN-IP-je, `8787`-es port. Ha a telefon nem látja a párost, a térkép **Beállítások** részén add meg kézzel, például:

```
ws://192.168.0.12:8787
```

A két telefonnak **ugyanarra** a relére kell csatlakoznia.

## Távolról (nem ugyanaz a Wi-Fi)

A relét ki kell tenni a netre, például Cloudflare Tunnel, ngrok, Fly.io vagy Render. A Beállításokban mindkét telefonon ugyanez a cím legyen, `wss://…` formában.

## Webes próba (két böngészőlap)

```bash
npm run relay
npm run web
```

Nyiss két lapot, hogy két külön profil legyen:

- http://localhost:8081/?profil=anna
- http://localhost:8081/?profil=bela

A webes nézet OpenStreetMap-alapú. A GPS-eltolás weben be van kapcsolva, hogy ugyanarról a gépről se takarjátok egymást.

## Háttérbeli helyzet

Az Expo Go **nem** tartja a helyzetet, ha bezárod az appot. Folyamatos háttérkövetéshez saját native build kell:

```bash
npx expo prebuild
npx expo run:android
# vagy EAS Build
```

## Tesztek

```bash
npm test
```
