import socket
import sys
import os
import uvicorn

# Ensure repository root and python folders are on path
sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("python"))

def find_available_port(candidate_ports=[8000, 8080, 8001, 8888, 5000]):
    for port in candidate_ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    return 8000

if __name__ == "__main__":
    port = find_available_port([8000, 8080, 8001, 8888, 5000])
    
    # Save active port so frontend or other tools know where backend is listening
    port_file = os.path.join(os.path.abspath("."), ".backend_port")
    try:
        with open(port_file, "w") as f:
            f.write(str(port))
    except Exception:
        pass

    print(f"\n=======================================================")
    print(f"  libvecdb Engine Server Starting on http://127.0.0.1:{port}")
    print(f"  Interactive Swagger Docs: http://127.0.0.1:{port}/docs")
    print(f"=======================================================\n")

    uvicorn.run("api.main:app", host="127.0.0.1", port=port, log_level="info")
