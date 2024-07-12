const fs = require("fs");
const http = require("http");
const express = require("express");
const socketio = require("socket.io");
const path = require("path");

const app = express();
const expressServer = http.createServer(app);

// Serve static files from the current directory
app.use(express.static(__dirname));

// Serve index.html for the root route
app.get('/', (req, res, next) => {
  const indexPath = path.join(__dirname, 'index.html');
  fs.access(indexPath, fs.constants.F_OK, (err) => {
    if (err) {
      console.error(`index.html not found at ${indexPath}`);
      return next(new Error('index.html not found'));
    }
    res.sendFile(indexPath);
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Add a catch-all route to serve index.html for any unmatched routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const io = socketio(expressServer, {
  cors: {
    origin: [
      "http://onlinevideochat.glitch.me",
      "https://onlinevideochat.glitch.me",
      "http://localhost:3000",
    ],
    methods: ["GET", "POST"],
  },
});

//offers will contain {}
const offers = [
  // offererUserName
  // offer
  // offerIceCandidates
  // answererUserName
  // answer
  // answererIceCandidates
];
const connectedSockets = [
  //username, socketId
];

io.on("connection", (socket) => {
  // console.log("Someone has connected");
  const userName = socket.handshake.auth.userName;
  const password = socket.handshake.auth.password;

  if (password !== "x") {
    socket.disconnect(true);
    return;
  }
  connectedSockets.push({
    socketId: socket.id,
    userName,
  });

  //a new client has joined. If there are any offers available,
  //emit them out
  if (offers.length) {
    socket.emit("availableOffers", offers);
  }

  socket.on("newAnswer", ({ answer, offererUserName, answererUserName }) => {
    console.log(
      `Relaying answer from ${answererUserName} to ${offererUserName}`
    );
    const offererSocket = connectedSockets.find(
      (s) => s.userName === offererUserName
    );
    if (offererSocket) {
      socket
        .to(offererSocket.socketId)
        .emit("answerResponse", { answer, from: answererUserName });
    }
  });

  socket.on("sendIceCandidateToSignalingServer", (iceCandidateObj) => {
    const { didIOffer, iceUserName, iceCandidate } = iceCandidateObj;
    // console.log(iceCandidate);
    if (didIOffer) {
      //this ice is coming from the offerer. Send to the answerer
      const offerInOffers = offers.find(
        (o) => o.offererUserName === iceUserName
      );
      if (offerInOffers) {
        offerInOffers.offerIceCandidates.push(iceCandidate);
        // 1. When the answerer answers, all existing ice candidates are sent
        // 2. Any candidates that come in after the offer has been answered, will be passed through
        if (offerInOffers.answererUserName) {
          //pass it through to the other socket
          const socketToSendTo = connectedSockets.find(
            (s) => s.userName === offerInOffers.answererUserName
          );
          if (socketToSendTo) {
            socket
              .to(socketToSendTo.socketId)
              .emit("receivedIceCandidateFromServer", iceCandidate);
          } else {
            console.log("Ice candidate recieved but could not find answere");
          }
        }
      }
    } else {
      const offerInOffers = offers.find(
        (o) => o.answererUserName === iceUserName
      );
      if (offerInOffers) {
        const socketToSendTo = connectedSockets.find(
          (s) => s.userName === offerInOffers.offererUserName
        );
        if (socketToSendTo) {
          socket
            .to(socketToSendTo.socketId)
            .emit("receivedIceCandidateFromServer", iceCandidate);
        } else {
          console.log("Ice candidate received but could not find offerer");
        }
      } else {
        console.log("Offer not found for ice candidate");
      }
    }
    console.log(offers);
  });
  //hangup functionality
  socket.on("hangup", (data) => {
    console.log(`${data.userName} initiated hangup`);

    // Find and remove the offer associated with this user
    const offerIndex = offers.findIndex(
      (o) =>
        o.offererUserName === data.userName ||
        o.answererUserName === data.userName
    );

    if (offerIndex !== -1) {
      const offer = offers[offerIndex];
      const otherUser =
        offer.offererUserName === data.userName
          ? offer.answererUserName
          : offer.offererUserName;

      // Remove the offer
      offers.splice(offerIndex, 1);

      // Notify the other user about the hangup
      const otherSocket = connectedSockets.find(
        (s) => s.userName === otherUser
      );
      if (otherSocket) {
        socket
          .to(otherSocket.socketId)
          .emit("peerHangup", { userName: data.userName });
      }
    }

    // Broadcast updated offers to all clients
    io.emit("availableOffers", offers);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log(`${userName} disconnected`);

    // Remove the socket from connectedSockets
    const index = connectedSockets.findIndex((s) => s.socketId === socket.id);
    if (index !== -1) {
      connectedSockets.splice(index, 1);
    }

    // Remove any offers associated with this user
    const offerIndex = offers.findIndex(
      (o) => o.offererUserName === userName || o.answererUserName === userName
    );

    if (offerIndex !== -1) {
      const offer = offers[offerIndex];
      const otherUser =
        offer.offererUserName === userName
          ? offer.answererUserName
          : offer.offererUserName;

      // Remove the offer
      offers.splice(offerIndex, 1);

      // Notify the other user about the disconnection
      const otherSocket = connectedSockets.find(
        (s) => s.userName === otherUser
      );
      if (otherSocket) {
        socket.to(otherSocket.socketId).emit("peerDisconnected", { userName });
      }

      // Broadcast updated offers to all clients
      io.emit("availableOffers", offers);
    }
  });
  socket.on("initiateCall", ({ targetUsername, callerUsername }, callback) => {
    const targetSocket = connectedSockets.find(
      (s) => s.userName === targetUsername
    );
    if (targetSocket) {
      socket
        .to(targetSocket.socketId)
        .emit("incomingCall", { from: callerUsername });
      callback({ success: true });
    } else {
      callback({ success: false, message: "User not found or not available" });
    }
  });

  socket.on("newOffer", ({ offer, targetUsername, offererUserName }) => {
    console.log(`Relaying offer from ${offererUserName} to ${targetUsername}`);
    const targetSocket = connectedSockets.find(
      (s) => s.userName === targetUsername
    );
    if (targetSocket) {
      socket
        .to(targetSocket.socketId)
        .emit("newOfferAwaiting", { offer, offererUserName });
    } else {
      socket.emit("userNotFound");
    }
  });

  socket.on("cancelCall", () => {
    // Remove any pending offers from this user
    const offerIndex = offers.findIndex(
      (o) => o.offererUserName === socket.userName && !o.answer
    );
    if (offerIndex !== -1) {
      const offer = offers[offerIndex];
      offers.splice(offerIndex, 1);

      const targetSocket = connectedSockets.find(
        (s) => s.userName === offer.answererUserName
      );
      if (targetSocket) {
        socket.to(targetSocket.socketId).emit("callCancelled");
      }
    }
  });
  socket.on("acceptCall", ({ from }) => {
    const callerSocket = connectedSockets.find((s) => s.userName === from);
    if (callerSocket) {
      io.to(callerSocket.socketId).emit("callAccepted", {
        by: socket.userName,
      });
    }
  });

  socket.on("rejectCall", ({ from }) => {
    const callerSocket = connectedSockets.find((s) => s.userName === from);
    if (callerSocket) {
      io.to(callerSocket.socketId).emit("callRejected", {
        by: socket.userName,
      });
    }
  });
  socket.on("callOffer", ({ offer, from, to }) => {
    const targetSocket = connectedSockets.find((s) => s.userName === to);
    if (targetSocket) {
      socket.to(targetSocket.socketId).emit("callOffer", { offer, from });
    }
  });

  socket.on("answerCall", ({ answer, from, to }) => {
    const targetSocket = connectedSockets.find((s) => s.userName === to);
    if (targetSocket) {
      socket.to(targetSocket.socketId).emit("callAnswer", { answer, from });
    }
  });

  socket.on("iceCandidate", ({ candidate, to, from }) => {
    console.log(`Relaying ICE candidate from ${from} to ${to}`);
    const targetSocket = connectedSockets.find((s) => s.userName === to);
    if (targetSocket) {
      socket
        .to(targetSocket.socketId)
        .emit("iceCandidate", { candidate, from });
    }
  });
});

expressServer.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
