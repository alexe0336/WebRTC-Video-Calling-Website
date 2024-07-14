(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const usernameSearchInput = document.getElementById("username-search");
    const searchCallButton = document.getElementById("search-call");
    // const waitingHangupButton = document.getElementById("waiting-hangup");
    const statusMessage = document.getElementById("status-message");

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

    let localStream; //a var to hold the local video stream
    let remoteStream; //a var to hold the remote video stream
    let peerConnection; //the peerConnection that the two clients use to talk
    let didIOffer = false;

    let peerConfiguration = {
      iceServers: [
        { urls: "stun:[2001:4860:4860::8888]:19302" }, // IPv6 STUN server
        { urls: "stun:[2001:4860:4860::8844]:19302" }, //IPv6 STUN server
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
      ],
      iceTransportPolicy: "all",
      iceCandidatePoolSize: 10,
    };

    //when a client initiates a call
    // In the call function, modify the socket.emit for "newOffer":
    const call = async (targetUsername) => {
      try {
        iceRestartAttempts = 0; // Reset the counter when starting a new call
        incomingCallUsername = targetUsername; // Set this so we know who we're calling
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
        setTimeout(forceIceRestart, 10000); // Force ICE restart after 10 seconds if not connected
      } catch (err) {
        console.error("Error in call function:", err);
        statusMessage.textContent = "Failed to initiate call";
      }
    };

    const answerOffer = async (offerObj) => {
      await fetchUserMedia();
      await createPeerConnection(offerObj);
      const answer = await peerConnection.createAnswer({}); //just to make the docs happy
      await peerConnection.setLocalDescription(answer); //this is CLIENT2, and CLIENT2 uses the answer as the localDesc
      console.log(offerObj);
      console.log(answer);
      // console.log(peerConnection.signalingState) //should be have-local-pranswer because CLIENT2 has set its local desc to it's answer (but it won't be)
      //add the answer to the offerObj so the server knows which offer this is related to
      offerObj.answer = answer;
      //emit the answer to the signaling server, so it can emit to CLIENT1
      //expect a response from the server with the already existing ICE candidates
      const offerIceCandidates = await socket.emitWithAck(
        "newAnswer",
        offerObj
      );
      offerIceCandidates.forEach((c) => {
        peerConnection.addIceCandidate(c);
        console.log("======Added Ice Candidate======");
      });
      console.log(offerIceCandidates);
    };

    const addAnswer = async (offerObj) => {
      //addAnswer is called in socketListeners when an answerResponse is emitted.
      //at this point, the offer and answer have been exchanged!
      //now CLIENT1 needs to set the remote
      await peerConnection.setRemoteDescription(offerObj.answer);
      // console.log(peerConnection.signalingState)
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
          if (
            err.name === "NotFoundError" ||
            err.name === "DevicesNotFoundError"
          ) {
            reject(
              new Error(
                "Camera or microphone not found. Please check your device connections."
              )
            );
          } else if (
            err.name === "NotAllowedError" ||
            err.name === "PermissionDeniedError"
          ) {
            reject(
              new Error(
                "Permission to use camera and microphone denied. Please allow access and try again."
              )
            );
          } else {
            reject(err);
          }
        }
      });
    };

    const createPeerConnection = (offerObj) => {
      return new Promise(async (resolve, reject) => {
        peerConnection = new RTCPeerConnection(peerConfiguration);
        remoteStream = new MediaStream();
        remoteVideoEl.srcObject = remoteStream;

        localStream.getTracks().forEach((track) => {
          peerConnection.addTrack(track, localStream);
        });

        peerConnection.addEventListener("signalingstatechange", (event) => {
          console.log("Signaling State:", peerConnection.signalingState);
        });

        peerConnection.addEventListener("iceconnectionstatechange", () => {
          console.log(
            "ICE Connection State:",
            peerConnection.iceConnectionState
          );
          if (peerConnection.iceConnectionState === "failed") {
            if (iceRestartAttempts < MAX_ICE_RESTART_ATTEMPTS) {
              console.log(`ICE restart attempt ${iceRestartAttempts + 1}`);
              peerConnection.restartIce();
              iceRestartAttempts++;
            } else {
              console.log(
                "Max ICE restart attempts reached. Connection failed."
              );
              // Handle the failure (e.g., notify user, clean up resources)
            }
          }
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
                // Handle the failure (e.g., notify user, clean up resources)
              }
            }
          });
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

    //Functions below this point

    function forceIceRestart() {
      if (peerConnection && peerConnection.iceConnectionState !== "connected") {
        console.log("Forcing ICE restart");
        peerConnection.restartIce();
      }
    }

    function hangup() {
      if (peerConnection) {
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

      localVideoEl.srcObject = null;
      remoteVideoEl.srcObject = null;

      didIOffer = false;

      socket.emit("hangup", { userName });

      if (isWaiting) {
        statusMessage.textContent = "Call cancelled";
      } else if (inCall) {
        statusMessage.textContent = "Call ended";
      } else {
        statusMessage.textContent = "";
      }

      console.log("Call ended or cancelled");
      inCall = false;
      isWaiting = false;
      incomingCallUsername = null;
      resetCallUI();
    }

    if (searchCallButton) {
      searchCallButton.addEventListener("click", searchAndCall);
    }
    // if (waitingHangupButton) {
    //   waitingHangupButton.addEventListener("click", handleWaitingHangup);
    // }

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

    //     function setWaitingState(waiting) {
    //       isWaiting = waiting;
    //       inCall = false;

    //       if (waiting) {
    //         statusMessage.textContent = "Waiting for answer...";
    //         updateCallUI("waiting"); // We'll add this new state to updateCallUI
    //       } else {
    //         statusMessage.textContent = "";
    //         resetCallUI();
    //       }
    //     }

    function setInCallState() {
      isWaiting = false;
      inCall = true;
      updateCallUI("inCall");
      updateCallStatus();
    }

    // function handleWaitingHangup() {
    //   if (inCall) {
    //     hangup();
    //   } else if (isWaiting) {
    //     cancelCall();
    //   }
    // }

    //     function cancelCall() {
    //       socket.emit("cancelCall", { from: userName });
    //       setWaitingState(false);
    //       statusMessage.textContent = "Call cancelled";
    //     }

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
        // Handle this case appropriately
      }
    });

    socket.on("callAccepted", ({ by }) => {
      if (!incomingCallUsername) {
        incomingCallUsername = by;
      }
      setInCallState();
    });

    socket.on("callRejected", () => {
      // setWaitingState(false);
      statusMessage.textContent = "Call rejected";
    });

    socket.on("userNotFound", () => {
      // setWaitingState(false);
      statusMessage.textContent = "User not found";
    });

    socket.on("peerHangup", () => {
      hangup();
      statusMessage.textContent = "The other user hung up";
    });
    //     socket.on("callOffer", async ({ offer, from }) => {
    //       try {
    //         incomingCallUsername = from;
    //         await createPeerConnection();
    //         await peerConnection.setRemoteDescription(
    //           new RTCSessionDescription(offer)
    //         );

    //         // Display incoming call UI here
    //         displayIncomingCallUI(from);
    //       } catch (error) {
    //         console.error("Error handling call offer:", error);
    //       }
    //     });

    // socket.on("callAnswer", async ({ answer, from }) => {
    //   try {
    //     await peerConnection.setRemoteDescription(
    //       new RTCSessionDescription(answer)
    //     );
    //     console.log("Call answered and remote description set");
    //   } catch (error) {
    //     console.error("Error handling call answer:", error);
    //   }
    // });
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

    function updateCallStatus() {
      if (inCall && incomingCallUsername) {
        statusMessage.textContent = `In call with ${incomingCallUsername}`;
      }
    }

    async function answerIncomingCall() {
      console.log("Answering call from:", incomingCallUsername);
      if (incomingCallUsername && peerConnection) {
        try {
          iceRestartAttempts = 0; // Reset the counter when answering a call
          await fetchUserMedia();

          localStream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, localStream);
          });

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          socket.emit("newAnswer", {
            answer,
            offererUserName: incomingCallUsername,
            answererUserName: userName,
          });

          setInCallState();
          statusMessage.textContent = `In call with ${incomingCallUsername}`;
          setTimeout(forceIceRestart, 10000); // Force ICE restart after 10 seconds if not connected
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
      controlsDiv.innerHTML = ""; // Clear existing buttons

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
      // 'default' state will clear all buttons
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
      updateCallUI("default"); // This will now clear all buttons
    }
  });
  // Place this code outside of the DOMContentLoaded event listener
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
