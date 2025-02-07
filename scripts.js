(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const usernameSearchInput = document.getElementById("username-search");
    const searchCallButton = document.getElementById("search-call");
    const waitingHangupButton = document.getElementById("waiting-hangup");
    const statusMessage = document.getElementById("status-message");

    let isWaiting = false;
    let inCall = false;
    let incomingCallUsername = null;

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
        {
          urls: [
            "stun:stun.l.google.com:19302",
            "stun:stun1.l.google.com:19302",
          ],
        },
      ],
    };

    //when a client initiates a call
    // In the call function, modify the socket.emit for "newOffer":
    const call = async (targetUsername) => {
      try {
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
          resolve();
        } catch (err) {
          console.log(err);
          reject();
        }
      });
    };

    const createPeerConnection = (offerObj) => {
      return new Promise(async (resolve, reject) => {
        //RTCPeerConnection is the thing that creates the connection
        //we can pass a config object, and that config object can contain stun servers
        //which will fetch us ICE candidates
        peerConnection = await new RTCPeerConnection(peerConfiguration);
        remoteStream = new MediaStream();
        remoteVideoEl.srcObject = remoteStream;

        localStream.getTracks().forEach((track) => {
          //add localtracks so that they can be sent once the connection is established
          peerConnection.addTrack(track, localStream);
        });

        peerConnection.addEventListener("signalingstatechange", (event) => {
          console.log(event);
          console.log(peerConnection.signalingState);
        });

        peerConnection.addEventListener("icecandidate", (e) => {
          console.log("........Ice candidate found!......");
          console.log(e);
          if (e.candidate) {
            socket.emit("sendIceCandidateToSignalingServer", {
              iceCandidate: e.candidate,
              iceUserName: userName,
              didIOffer,
            });
          }
        });

        peerConnection.addEventListener("track", (e) => {
          console.log("Got a track from the other peer!! How exciting");
          console.log(e);
          e.streams[0].getTracks().forEach((track) => {
            remoteStream.addTrack(track, remoteStream);
            console.log("Here's an exciting moment... fingers crossed");
          });
        });

        if (offerObj) {
          //this won't be set when called from call();
          //will be set when we call from answerOffer()
          // console.log(peerConnection.signalingState) //should be stable because no setDesc has been run yet
          await peerConnection.setRemoteDescription(offerObj.offer);
          // console.log(peerConnection.signalingState) //should be have-remote-offer, because client2 has setRemoteDesc on the offer
        }
        resolve();
      });
    };

    const addNewIceCandidate = (iceCandidate) => {
      peerConnection.addIceCandidate(iceCandidate);
      console.log("======Added Ice Candidate======");
    };

    const hangup = () => {
      if (peerConnection) {
        // Close the peer connection
        peerConnection.close();
        peerConnection = null;
      }

      if (localStream) {
        // Stop all tracks in the local stream
        localStream.getTracks().forEach((track) => track.stop());
        localStream = null;
      }

      if (remoteStream) {
        // Stop all tracks in the remote stream
        remoteStream.getTracks().forEach((track) => track.stop());
        remoteStream = null;
      }

      // Clear the video elements
      localVideoEl.srcObject = null;
      remoteVideoEl.srcObject = null;

      // Reset the offer flag
      didIOffer = false;

      // Emit a hangup event to the server
      socket.emit("hangup", { userName });

      console.log("Call ended");
      setWaitingState(false);
      statusMessage.textContent = "Call ended";
      incomingCallUsername = null;
      resetCallUI();
    };

    if (searchCallButton) {
      searchCallButton.addEventListener("click", searchAndCall);
    }
    if (waitingHangupButton) {
      waitingHangupButton.addEventListener("click", handleWaitingHangup);
    }

    const hangupButton = document.querySelector("#hangup");
    if (hangupButton) {
      hangupButton.addEventListener("click", hangup);
    }

    function searchAndCall() {
      const targetUsername = usernameSearchInput.value.trim();
      if (targetUsername) {
        socket.emit(
          "initiateCall",
          { targetUsername, callerUsername: userName },
          (response) => {
            if (response.success) {
              setWaitingState(true);
              statusMessage.textContent = `Calling ${targetUsername}...`;
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

      const answerButton = document.createElement("button");
      answerButton.textContent = "Answer";
      answerButton.classList.add("btn", "btn-success", "mr-2");
      answerButton.addEventListener("click", answerIncomingCall);

      const rejectButton = document.createElement("button");
      rejectButton.textContent = "Reject";
      rejectButton.classList.add("btn", "btn-danger");
      rejectButton.addEventListener("click", rejectIncomingCall);

      // Clear any existing buttons and add new ones
      const controlsDiv = document.querySelector(".controls");
      controlsDiv.innerHTML = "";
      controlsDiv.appendChild(answerButton);
      controlsDiv.appendChild(rejectButton);
    }

    function setWaitingState(waiting) {
      isWaiting = waiting;
      inCall = false;
      waitingHangupButton.textContent = waiting ? "Waiting for Call" : "Hangup";
      waitingHangupButton.classList.toggle("btn-warning", waiting);
      waitingHangupButton.classList.toggle("btn-danger", !waiting);
    }

    function setInCallState() {
      isWaiting = false;
      inCall = true;
      waitingHangupButton.textContent = "Hangup";
      waitingHangupButton.classList.remove("btn-warning");
      waitingHangupButton.classList.add("btn-danger");
    }

    function handleWaitingHangup() {
      if (inCall) {
        hangup();
      } else if (isWaiting) {
        cancelCall();
      }
    }

    function cancelCall() {
      socket.emit("cancelCall");
      setWaitingState(false);
      statusMessage.textContent = "Call cancelled";
    }

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
    socket.on("incomingCall", ({ from }) => {
      console.log("Incoming call from:", from);
      displayIncomingCallUI(from);
    });

    socket.on("callAccepted", () => {
      setInCallState();
      statusMessage.textContent = "Call connected";
    });

    socket.on("callRejected", () => {
      setWaitingState(false);
      statusMessage.textContent = "Call rejected";
    });

    socket.on("userNotFound", () => {
      setWaitingState(false);
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
    socket.on("newOfferAwaiting", async ([offerObj]) => {
      try {
        incomingCallUsername = offerObj.offererUserName;
        await createPeerConnection(offerObj);
        displayIncomingCallUI(offerObj.offererUserName);
        console.log("Incoming call from:", offerObj.offererUserName); // Add this line for debugging
      } catch (error) {
        console.error("Error handling new offer:", error);
      }
    });

    async function answerIncomingCall() {
      console.log("Answering call from:", incomingCallUsername);
      if (incomingCallUsername) {
        try {
          await fetchUserMedia();

          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);

          socket.emit("newAnswer", {
            answer,
            offererUserName: incomingCallUsername,
            answererUserName: userName,
          });

          setInCallState();
          statusMessage.textContent = `In call with ${incomingCallUsername}`;
        } catch (error) {
          console.error("Error in answerIncomingCall:", error);
          statusMessage.textContent = "Failed to establish call";
        }
      } else {
        console.error("No incoming call to answer");
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
      const controlsDiv = document.querySelector(".controls");
      controlsDiv.innerHTML = `
      <button id="waiting-hangup" class="btn btn-warning">
        <i class="fas fa-clock"></i> Waiting for Call
      </button>
    `;
      const waitingHangupButton = document.getElementById("waiting-hangup");
      if (waitingHangupButton) {
        waitingHangupButton.addEventListener("click", handleWaitingHangup);
      }
    }
  });
})();
