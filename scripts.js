(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const usernameSearchInput = document.getElementById("username-search");
    const searchCallButton = document.getElementById("search-call");
    const statusMessage = document.getElementById("status-message");
    const sendButton = document.getElementById("send-message");
    const messageInput = document.getElementById("message-input");

    let isWaiting = false;
    let inCall = false;
    let incomingCallUsername = null;

    let iceRestartAttempts = 0;
    const MAX_ICE_RESTART_ATTEMPTS = 3;

    const userName = "User-" + Math.floor(Math.random() * 100000);
    const password = "x";
    const userNameElement = document.querySelector("#user-name");
    if (userNameElement) {
      userNameElement.innerHTML = userName;
    }

    const socket = io.connect("https://onlinevideochat.glitch.me", {
      auth: {
        userName,
        password,
      },
    });

    const localVideoEl = document.querySelector("#local-video");
    const remoteVideoEl = document.querySelector("#remote-video");

    let localStream;
    let remoteStream;
    let peerConnection;
    let dataChannel;
    let didIOffer = false;

    let peerConfiguration = {
      iceServers: [
        { urls: "stun:[2001:4860:4860::8888]:19302" },
        { urls: "stun:[2001:4860:4860::8844]:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
      ],
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 10,
    };

    const call = async (targetUsername) => {
      try {
        iceRestartAttempts = 0;
        incomingCallUsername = targetUsername;
        await fetchUserMedia();
        await createPeerConnection();

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit("newOffer", {
          offer,
          targetUsername,
          offererUserName: userName,
        });
        didIOffer = true;
        statusMessage.textContent = `Calling ${targetUsername}...`;
        setTimeout(forceIceRestart, 10000);
      } catch (err) {
        console.error("Error in call function:", err);
        statusMessage.textContent = "Failed to initiate call";
      }
    };

    const answerOffer = async (offerObj) => {
      await fetchUserMedia();
      await createPeerConnection(offerObj);
      const answer = await peerConnection.createAnswer({});
      await peerConnection.setLocalDescription(answer);
      offerObj.answer = answer;
      const offerIceCandidates = await socket.emitWithAck(
        "newAnswer",
        offerObj
      );
      offerIceCandidates.forEach((c) => {
        peerConnection.addIceCandidate(c);
        console.log("======Added Ice Candidate======");
      });
    };

    const addAnswer = async (offerObj) => {
      await peerConnection.setRemoteDescription(offerObj.answer);
    };

    const fetchUserMedia = () => {
      return new Promise(async (resolve, reject) => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true,
          });
          localVideoEl.srcObject = stream;
          localStream = stream;
          resolve(stream);
        } catch (err) {
          console.error("Error accessing media devices:", err);
          reject(err);
        }
      });
    };

    const createPeerConnection = (offerObj) => {
      return new Promise(async (resolve, reject) => {
        peerConnection = new RTCPeerConnection(peerConfiguration);
        peerConnection.dataChannel = null; // Initialize dataChannel property

        remoteStream = new MediaStream();
        remoteVideoEl.srcObject = remoteStream;

        localStream.getTracks().forEach((track) => {
          peerConnection.addTrack(track, localStream);
        });

        if (!offerObj) {
          console.log("Creating data channel (caller)");
          peerConnection.dataChannel = peerConnection.createDataChannel("chat");
          setupDataChannel(peerConnection.dataChannel);
        } else {
          console.log("Waiting for data channel (callee)");
          peerConnection.ondatachannel = (event) => {
            console.log("Received data channel (callee)");
            peerConnection.dataChannel = event.channel;
            setupDataChannel(peerConnection.dataChannel);
          };
        }

        peerConnection.addEventListener("signalingstatechange", (event) => {
          console.log("Signaling State:", peerConnection.signalingState);
        });

        peerConnection.addEventListener("iceconnectionstatechange", () => {
          console.log(
            "ICE Connection State:",
            peerConnection.iceConnectionState
          );
          if (peerConnection.iceConnectionState === "connected") {
            setInCallState();
            updateCallStatus();
          } else if (peerConnection.iceConnectionState === "failed") {
            if (iceRestartAttempts < MAX_ICE_RESTART_ATTEMPTS) {
              console.log(`ICE restart attempt ${iceRestartAttempts + 1}`);
              peerConnection.restartIce();
              iceRestartAttempts++;
            } else {
              console.log(
                "Max ICE restart attempts reached. Connection failed."
              );
            }
          }
        });

        peerConnection.onicegatheringstatechange = (ev) => {
          let connection = ev.target;
          switch (connection.iceGatheringState) {
            case "gathering":
              console.log("ICE gathering started");
              break;
            case "complete":
              console.log("ICE gathering completed");
              break;
          }
        };

        let ipv6CandidateFound = false;

        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            const isIPv6 =
              event.candidate.address &&
              event.candidate.address.indexOf(":") !== -1;
            console.log(
              `New ICE candidate (${isIPv6 ? "IPv6" : "IPv4"}):`,
              event.candidate.candidate
            );

            if (isIPv6 && !ipv6CandidateFound) {
              ipv6CandidateFound = true;
              console.log("First IPv6 candidate found, prioritizing it");
              peerConnection.addIceCandidate(event.candidate);
            }

            socket.emit("sendIceCandidateToSignalingServer", {
              iceCandidate: event.candidate,
              iceUserName: userName,
              didIOffer,
            });
          }
        };

        peerConnection.addEventListener("track", (e) => {
          console.log("Received remote track");
          e.streams[0].getTracks().forEach((track) => {
            remoteStream.addTrack(track);
          });
        });

        if (offerObj) {
          await peerConnection.setRemoteDescription(offerObj.offer);
        }
        resolve();
      });
    };

    const addNewIceCandidate = (iceCandidate) => {
      peerConnection.addIceCandidate(iceCandidate);
      console.log("======Added Ice Candidate======");
    };

    function forceIceRestart() {
      if (peerConnection && peerConnection.iceConnectionState !== "connected") {
        console.log("Forcing ICE restart");
        peerConnection.restartIce();
      }
    }

    function hangup() {
      if (peerConnection) {
        if (peerConnection.dataChannel) {
          peerConnection.dataChannel.close();
        }
        peerConnection.close();
        peerConnection = null;
      }

      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
        localStream = null;
      }

      if (remoteStream) {
        remoteStream.getTracks().forEach((track) => track.stop());
        remoteStream = null;
      }

      if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
      }

      localVideoEl.srcObject = null;
      remoteVideoEl.srcObject = null;

      didIOffer = false;

      socket.emit("hangup", { userName });

      console.log("Call ended");
      inCall = false;
      isWaiting = false;
      statusMessage.textContent = "Call ended";
      incomingCallUsername = null;
      resetCallUI();
      disableChatInterface();
    }

    if (searchCallButton) {
      searchCallButton.addEventListener("click", searchAndCall);
    }

    const hangupButton = document.querySelector("#hangup");
    if (hangupButton) {
      hangupButton.addEventListener("click", hangup);
    }

    function handleIncomingOffer(offerObj) {
      console.log("Received offer:", offerObj);
      if (!offerObj || !offerObj.offer) {
        console.error("Invalid offer object received");
        return;
      }
      incomingCallUsername = offerObj.offererUserName;

      if (!offerObj.offer || !offerObj.offer.type) {
        console.error("Invalid offer object received");
        return;
      }

      peerConnection = new RTCPeerConnection(peerConfiguration);
      setupPeerConnectionListeners(peerConnection);

      peerConnection
        .setRemoteDescription(new RTCSessionDescription(offerObj.offer))
        .then(() => {
          console.log("Set remote description success");
          displayIncomingCallUI(offerObj.offererUserName);
        })
        .catch((error) => {
          console.error("Error setting remote description:", error);
        });
    }
    function searchAndCall() {
      const targetUsername = usernameSearchInput.value.trim();
      if (targetUsername) {
        socket.emit(
          "initiateCall",
          { targetUsername, callerUsername: userName },
          (response) => {
            if (response.success) {
              isWaiting = true;
              statusMessage.textContent = `Calling ${targetUsername}...`;
              updateCallUI("waiting");
              call(targetUsername);
            } else {
              statusMessage.textContent =
                response.message || "User not available";
            }
          }
        );
      } else {
        statusMessage.textContent = "Please enter a username to call";
      }
    }

    function displayIncomingCallUI(from) {
      incomingCallUsername = from;
      statusMessage.textContent = `Incoming call from ${from}`;
      updateCallUI("incoming");
    }

    function setInCallState() {
      isWaiting = false;
      inCall = true;
      updateCallUI("inCall");
      updateCallStatus();
      enableChatInterface();
    }

    function updateCallStatus() {
      if (inCall && incomingCallUsername) {
        statusMessage.textContent = `In call with ${incomingCallUsername}`;
      }
    }

    function cancelCall() {
      hangup();
      statusMessage.textContent = "Call cancelled";
    }

    async function answerIncomingCall() {
      console.log("Answering call from:", incomingCallUsername);
      if (incomingCallUsername && peerConnection) {
        try {
          iceRestartAttempts = 0;
          await fetchUserMedia();

          localStream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, localStream);
          });

          // Ensure this is set up before creating the answer
          peerConnection.ondatachannel = (event) => {
            console.log("Received data channel");
            peerConnection.dataChannel = event.channel;
            setupDataChannel(peerConnection.dataChannel);
          };

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          socket.emit("newAnswer", {
            answer,
            offererUserName: incomingCallUsername,
            answererUserName: userName,
          });

          setInCallState();
          statusMessage.textContent = `In call with ${incomingCallUsername}`;
          setTimeout(forceIceRestart, 10000);
        } catch (error) {
          console.error("Error in answerIncomingCall:", error);
          statusMessage.textContent =
            error.message || "Failed to establish call";
        }
      } else {
        console.error(
          "No incoming call to answer or peerConnection not created"
        );
        statusMessage.textContent = "Unable to answer call. Please try again.";
      }
    }

    function setupPeerConnectionListeners(pc) {
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log("New ICE candidate:", event.candidate);
          socket.emit("iceCandidate", {
            candidate: event.candidate,
            to: incomingCallUsername,
            from: userName,
          });
        }
      };

      pc.ontrack = (event) => {
        console.log("Received remote track");
        remoteVideoEl.srcObject = event.streams[0];
      };

      pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", pc.iceConnectionState);
      };
    }

    function updateCallUI(state) {
      const controlsDiv = document.querySelector(".controls");
      controlsDiv.innerHTML = "";

      if (state === "incoming") {
        const answerButton = document.createElement("button");
        answerButton.textContent = "Answer";
        answerButton.classList.add("btn", "btn-success", "mr-2");
        answerButton.addEventListener("click", answerIncomingCall);

        const rejectButton = document.createElement("button");
        rejectButton.textContent = "Reject";
        rejectButton.classList.add("btn", "btn-danger");
        rejectButton.addEventListener("click", rejectIncomingCall);

        controlsDiv.appendChild(answerButton);
        controlsDiv.appendChild(rejectButton);
      } else if (state === "inCall" || state === "waiting") {
        const hangupButton = document.createElement("button");
        hangupButton.textContent = "Hangup";
        hangupButton.classList.add("btn", "btn-danger");
        hangupButton.addEventListener("click", hangup);

        controlsDiv.appendChild(hangupButton);
      }
    }

    function rejectIncomingCall() {
      console.log("Rejecting call from:", incomingCallUsername);
      if (incomingCallUsername) {
        socket.emit("rejectCall", { from: userName, to: incomingCallUsername });
        incomingCallUsername = null;
        statusMessage.textContent = "Call rejected";
        resetCallUI();
      } else {
        console.error("No incoming call to reject");
      }
    }

    function resetCallUI() {
      updateCallUI("default");
    }

    // Chat functionality
    function setupDataChannel(channel) {
      channel.onopen = () => {
        console.log("Data channel is open");
        enableChatInterface();
      };

      channel.onmessage = (event) => {
        console.log("Received message:", event.data);
        const { message, senderUsername } = JSON.parse(event.data);
        displayMessage(message, false, senderUsername);
      };

      channel.onclose = () => {
        console.log("Data channel is closed");
        disableChatInterface();
      };

      channel.onerror = (error) => {
        console.error("Data channel error:", error);
      };
    }

    function enableChatInterface() {
      const chatInterface = document.getElementById("chat-interface");
      chatInterface.style.display = "block";
      sendButton.disabled = false;
      messageInput.disabled = false;
    }

    function disableChatInterface() {
      const chatInterface = document.getElementById("chat-interface");
      chatInterface.style.display = "none";
      sendButton.disabled = true;
      messageInput.disabled = true;
    }

    function displayMessage(message, isLocal, senderUsername) {
      const chatMessages = document.getElementById("chat-messages");
      const messageElement = document.createElement("div");
      const sender = isLocal ? "You" : senderUsername;
      messageElement.textContent = `${sender}: ${message}`;
      messageElement.className = isLocal ? "local-message" : "remote-message";
      chatMessages.appendChild(messageElement);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function sendMessage() {
      const message = messageInput.value.trim();
      if (
        message &&
        peerConnection &&
        peerConnection.dataChannel &&
        peerConnection.dataChannel.readyState === "open"
      ) {
        try {
          const messageData = JSON.stringify({
            message: message,
            senderUsername: userName,
          });
          peerConnection.dataChannel.send(messageData);
          displayMessage(message, true, userName);
          messageInput.value = "";
        } catch (error) {
          console.error("Error sending message:", error);
        }
      } else {
        console.log("Cannot send message. Data channel not ready.");
        if (peerConnection && peerConnection.dataChannel) {
          console.log(
            "Data channel state:",
            peerConnection.dataChannel.readyState
          );
        }
      }
    }

    sendButton.addEventListener("click", sendMessage);
    messageInput.addEventListener("keypress", (event) => {
      if (event.key === "Enter") {
        sendMessage();
      }
    });

    // Initially disable the chat interface
    disableChatInterface();

    // Socket listeners
    socket.on("answerResponse", (offerObj) => {
      console.log(offerObj);
      addAnswer(offerObj);
    });

    socket.on("receivedIceCandidateFromServer", (iceCandidate) => {
      if (peerConnection) {
        peerConnection
          .addIceCandidate(new RTCIceCandidate(iceCandidate))
          .then(() => console.log("Added ICE candidate successfully"))
          .catch((error) =>
            console.error("Error adding received ICE candidate:", error)
          );
      }
    });

    socket.on("incomingCall", ({ from, offer }) => {
      console.log("Incoming call from:", from);
      if (offer) {
        handleIncomingOffer({ offer, offererUserName: from });
      } else {
        console.error("Received incomingCall event without an offer");
      }
    });

    socket.on("callAccepted", ({ by }) => {
      if (!incomingCallUsername) {
        incomingCallUsername = by;
      }
      setInCallState();
    });

    socket.on("callRejected", () => {
      isWaiting = false;
      statusMessage.textContent = "Call rejected";
      resetCallUI();
    });

    socket.on("userNotFound", () => {
      isWaiting = false;
      statusMessage.textContent = "User not found";
      resetCallUI();
    });

    socket.on("peerHangup", () => {
      hangup();
      statusMessage.textContent = "The other user hung up";
    });

    socket.on("iceCandidate", async ({ candidate, from }) => {
      try {
        if (peerConnection) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          console.log("Added ICE candidate");
        }
      } catch (error) {
        console.error("Error adding received ICE candidate:", error);
      }
    });

    socket.on("newOfferAwaiting", (offerObj) => {
      handleIncomingOffer(offerObj);
    });
  });

  // Copy username functionality
  document.addEventListener("click", function (event) {
    if (event.target && event.target.id === "copy-username") {
      const usernameElement = document.getElementById("user-name");
      if (usernameElement) {
        const username = usernameElement.textContent;

        navigator.clipboard
          .writeText(username)
          .then(() => {
            event.target.textContent = "Copied!";
            setTimeout(() => {
              event.target.textContent = "Copy";
            }, 2000);
          })
          .catch((err) => {
            console.error("Failed to copy: ", err);
          });
      }
    }
  });
})();
