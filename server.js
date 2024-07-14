const fs = require("fs");
const http = require("http");
const express = require("express");
const socketio = require("socket.io");
const path = require("path");

const app = express();
const expressServer = http.createServer(app);

console.log("Server initialization started");

// Serve static files from the current directory
app.use(express.static(__dirname));
console.log("Static file serving configured");

// Serve index.html for the root route
app.get("/", (req, res, next) => {
  console.log("Received request for root route");
  const indexPath = path.join(__dirname, "index.html");
  fs.access(indexPath, fs.constants.F_OK, (err) => {
    if (err) {
      console.error(`Error: index.html not found at ${indexPath}`);
      return next(new Error("index.html not found"));
    }
    console.log("Serving index.html");
    res.sendFile(indexPath);
  });
});

app.use((err, req, res, next) => {
  console.error("Express error handler caught an error:", err.stack);
  res.status(500).send("Something broke!");
});

// Add a catch-all route to serve index.html for any unmatched routes
app.use((req, res) => {
  console.log(`Unmatched route requested: ${req.url}`);
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
console.log("Socket.IO initialized with CORS settings");

const offers = [];
const connectedSockets = [];

io.on("connection", (socket) => {
  console.log("New socket connection established");
  const userName = socket.handshake.auth.userName;
  const password = socket.handshake.auth.password;

  if (password !== "x") {
    console.log(`Authentication failed for user: ${userName}`);
    socket.disconnect(true);
    return;
  }
  console.log(`User authenticated: ${userName}`);
  connectedSockets.push({
    socketId: socket.id,
    userName,
  });
  console.log(`Connected sockets: ${connectedSockets.length}`);

  if (offers.length) {
    console.log(`Emitting ${offers.length} available offers to new user`);
    socket.emit("availableOffers", offers);
  }

  socket.on("newAnswer", ({ answer, offererUserName, answererUserName }) => {
    console.log(
      `New answer received from ${answererUserName} for ${offererUserName}`
    );
    const offererSocket = connectedSockets.find(
      (s) => s.userName === offererUserName
    );
    if (offererSocket) {
      console.log(`Relaying answer to ${offererUserName}`);
      socket
        .to(offererSocket.socketId)
        .emit("answerResponse", { answer, from: answererUserName });
    } else {
      console.error(`Error: Offerer socket not found for ${offererUserName}`);
    }
  });

  socket.on("sendIceCandidateToSignalingServer", (iceCandidateObj) => {
    const { didIOffer, iceUserName, iceCandidate } = iceCandidateObj;
    console.log(`ICE candidate received from ${iceUserName}`);

    if (didIOffer) {
      const offerInOffers = offers.find(
        (o) => o.offererUserName === iceUserName
      );
      if (offerInOffers) {
        offerInOffers.offerIceCandidates.push(iceCandidate);
        console.log(`ICE candidate added to offer from ${iceUserName}`);
        if (offerInOffers.answererUserName) {
          const socketToSendTo = connectedSockets.find(
            (s) => s.userName === offerInOffers.answererUserName
          );
          if (socketToSendTo) {
            console.log(
              `Relaying ICE candidate to answerer ${offerInOffers.answererUserName}`
            );
            socket
              .to(socketToSendTo.socketId)
              .emit("receivedIceCandidateFromServer", iceCandidate);
          } else {
            console.error(
              `Error: Answerer socket not found for ${offerInOffers.answererUserName}`
            );
          }
        }
      } else {
        console.error(
          `Error: Offer not found for ICE candidate from ${iceUserName}`
        );
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
          console.log(
            `Relaying ICE candidate to offerer ${offerInOffers.offererUserName}`
          );
          socket
            .to(socketToSendTo.socketId)
            .emit("receivedIceCandidateFromServer", iceCandidate);
        } else {
          console.error(
            `Error: Offerer socket not found for ${offerInOffers.offererUserName}`
          );
        }
      } else {
        console.error(
          `Error: Offer not found for ICE candidate from answerer ${iceUserName}`
        );
      }
    }
    console.log(`Current offers: ${JSON.stringify(offers)}`);
  });

  socket.on("hangup", (data) => {
    console.log(`Hangup/Cancel initiated by ${data.userName}`);

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

      offers.splice(offerIndex, 1);
      console.log(`Offer removed for ${data.userName}`);

      const otherSocket = connectedSockets.find(
        (s) => s.userName === otherUser
      );
      if (otherSocket) {
        console.log(`Notifying ${otherUser} about hangup/cancel`);
        socket
          .to(otherSocket.socketId)
          .emit("peerHangup", { userName: data.userName });
      } else {
        console.error(`Error: Other user socket not found for ${otherUser}`);
      }
    } else {
      console.log(`No offer found for hangup/cancel from ${data.userName}`);
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${userName}`);

    const index = connectedSockets.findIndex((s) => s.socketId === socket.id);
    if (index !== -1) {
      connectedSockets.splice(index, 1);
      console.log(`Removed socket for ${userName}`);
    } else {
      console.error(
        `Error: Socket not found for disconnecting user ${userName}`
      );
    }

    const offerIndex = offers.findIndex(
      (o) => o.offererUserName === userName || o.answererUserName === userName
    );

    if (offerIndex !== -1) {
      const offer = offers[offerIndex];
      const otherUser =
        offer.offererUserName === userName
          ? offer.answererUserName
          : offer.offererUserName;

      offers.splice(offerIndex, 1);
      console.log(`Removed offer associated with ${userName}`);

      const otherSocket = connectedSockets.find(
        (s) => s.userName === otherUser
      );
      if (otherSocket) {
        console.log(`Notifying ${otherUser} about disconnection`);
        socket.to(otherSocket.socketId).emit("peerDisconnected", { userName });
      } else {
        console.error(`Error: Other user socket not found for ${otherUser}`);
      }

      console.log("Broadcasting updated offers to all clients");
      io.emit("availableOffers", offers);
    }
  });

  socket.on("initiateCall", ({ targetUsername, callerUsername }, callback) => {
    console.log(
      `Call initiation request from ${callerUsername} to ${targetUsername}`
    );
    const targetSocket = connectedSockets.find(
      (s) => s.userName === targetUsername
    );
    if (targetSocket) {
      console.log(`Emitting incoming call event to ${targetUsername}`);
      socket
        .to(targetSocket.socketId)
        .emit("incomingCall", { from: callerUsername });
      callback({ success: true });
    } else {
      console.log(`Target user ${targetUsername} not found or not available`);
      callback({ success: false, message: "User not found or not available" });
    }
  });

  socket.on("newOffer", ({ offer, targetUsername, offererUserName }) => {
    console.log(`New offer from ${offererUserName} to ${targetUsername}`);
    const targetSocket = connectedSockets.find(
      (s) => s.userName === targetUsername
    );
    if (targetSocket) {
      console.log(`Relaying offer to ${targetUsername}`);
      socket
        .to(targetSocket.socketId)
        .emit("incomingCall", { from: offererUserName, offer });
    } else {
      console.error(`Error: Target user ${targetUsername} not found`);
      socket.emit("userNotFound");
    }
  });

  socket.on("cancelCall", () => {
    console.log(`Call cancellation request from ${socket.userName}`);
    const offerIndex = offers.findIndex(
      (o) => o.offererUserName === socket.userName && !o.answer
    );
    if (offerIndex !== -1) {
      const offer = offers[offerIndex];
      offers.splice(offerIndex, 1);
      console.log(`Removed pending offer from ${socket.userName}`);

      const targetSocket = connectedSockets.find(
        (s) => s.userName === offer.answererUserName
      );
      if (targetSocket) {
        console.log(
          `Notifying ${offer.answererUserName} about call cancellation`
        );
        socket.to(targetSocket.socketId).emit("callCancelled");
      } else {
        console.error(
          `Error: Target socket not found for ${offer.answererUserName}`
        );
      }
    } else {
      console.log(`No pending offer found for ${socket.userName}`);
    }
  });

  socket.on("acceptCall", ({ from }) => {
    console.log(`Call acceptance from ${socket.userName} for ${from}`);
    const callerSocket = connectedSockets.find((s) => s.userName === from);
    if (callerSocket) {
      console.log(`Notifying ${from} about call acceptance`);
      io.to(callerSocket.socketId).emit("callAccepted", {
        by: socket.userName,
      });
    } else {
      console.error(`Error: Caller socket not found for ${from}`);
    }
  });

  socket.on("rejectCall", ({ from }) => {
    console.log(`Call rejection from ${socket.userName} for ${from}`);
    const callerSocket = connectedSockets.find((s) => s.userName === from);
    if (callerSocket) {
      console.log(`Notifying ${from} about call rejection`);
      io.to(callerSocket.socketId).emit("callRejected", {
        by: socket.userName,
      });
    } else {
      console.error(`Error: Caller socket not found for ${from}`);
    }
  });

  socket.on("callOffer", ({ offer, from, to }) => {
    console.log(`Call offer from ${from} to ${to}`);
    const targetSocket = connectedSockets.find((s) => s.userName === to);
    if (targetSocket) {
      console.log(`Relaying call offer to ${to}`);
      socket.to(targetSocket.socketId).emit("callOffer", { offer, from });
    } else {
      console.error(`Error: Target socket not found for ${to}`);
    }
  });

  socket.on("answerCall", ({ answer, from, to }) => {
    console.log(`Call answer from ${from} to ${to}`);
    const targetSocket = connectedSockets.find((s) => s.userName === to);
    if (targetSocket) {
      console.log(`Relaying call answer to ${to}`);
      socket.to(targetSocket.socketId).emit("callAnswer", { answer, from });
    } else {
      console.error(`Error: Target socket not found for ${to}`);
    }
  });

  socket.on("iceCandidate", ({ candidate, to, from }) => {
    console.log(`ICE candidate from ${from} to ${to}`);
    const targetSocket = connectedSockets.find((s) => s.userName === to);
    if (targetSocket) {
      console.log(`Relaying ICE candidate to ${to}`);
      socket
        .to(targetSocket.socketId)
        .emit("iceCandidate", { candidate, from });
    } else {
      console.error(`Error: Target socket not found for ${to}`);
    }
  });
});

expressServer.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on port ${process.env.PORT || 3000}`);
});
