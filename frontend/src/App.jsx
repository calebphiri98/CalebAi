import { useState } from "react";

function App() {
  const [response, setResponse] = useState("");

  const sendMessage = async () => {
    try {
      const res = await fetch("http://localhost:5000/");

      const data = await res.json();

      setResponse(data.message);
    } catch (error) {
      console.error(error);
      setResponse("Could not connect to the backend.");
    }
  };

  return (
    <div>
      <h1>Caleb AI</h1>

      <p>My AI assistant is being built.</p>

      <button onClick={sendMessage}>
        Test Backend Connection
      </button>

      {response && (
        <p>
          Backend says: <strong>{response}</strong>
        </p>
      )}
    </div>
  );
}

export default App;