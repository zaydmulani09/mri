// Category: deferred work after the guard verdict window.
// The synchronous script returns immediately; this microtask burst keeps
// burning CPU AFTER mri has already reported EXECUTED cleanly.
Promise.resolve().then(() => {
  let sink = 0;
  for (let i = 0; i < 5e7; i++) sink += i % 7;
  console.log("B03 post-verdict burst finished, sink:", sink);
});
