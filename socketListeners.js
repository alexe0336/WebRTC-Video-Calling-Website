// //on connection get all available offers and call createOfferEls
// socket.on("availableOffers", (offers) => {
//   console.log(offers);
//   createOfferEls(offers);
// });

// //someone just made a new offer and we're already here - call createOfferEls
// socket.on("newOfferAwaiting", (offers) => {
//   createOfferEls(offers);
// });

// socket.on("answerResponse", (offerObj) => {
//   console.log(offerObj);
//   addAnswer(offerObj);
// });

// socket.on("receivedIceCandidateFromServer", (iceCandidate) => {
//   addNewIceCandidate(iceCandidate);
//   console.log(iceCandidate);
// });

// // Socket listeners
// socket.on("incomingCall", ({ from }) => {
//   statusMessage.textContent = `Incoming call from ${from}`;
//   // Add UI to accept or reject the call
// });

// socket.on("callAccepted", () => {
//   setInCallState();
//   statusMessage.textContent = "Call connected";
// });

// socket.on("callRejected", () => {
//   setWaitingState(false);
//   statusMessage.textContent = "Call rejected";
// });

// socket.on("userNotFound", () => {
//   setWaitingState(false);
//   statusMessage.textContent = "User not found";
// });

// socket.on("peerHangup", () => {
//   hangup();
//   statusMessage.textContent = "The other user hung up";
// });

// function createOfferEls(offers) {
//   //make green answer button for this new offer
//   const answerEl = document.querySelector("#answer");
//   offers.forEach((o) => {
//     console.log(o);
//     const newOfferEl = document.createElement("div");
//     newOfferEl.innerHTML = `<button class="btn btn-success col-1">Answer ${o.offererUserName}</button>`;
//     newOfferEl.addEventListener("click", () => answerOffer(o));
//     answerEl.appendChild(newOfferEl);
//   });
// }
