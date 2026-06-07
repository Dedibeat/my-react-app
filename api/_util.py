import json


def cors_headers() -> dict:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }


def ok(data, status: int = 200) -> dict:
    return {
        "statusCode": status,
        "headers": {**cors_headers(), "Content-Type": "application/json"},
        "body": json.dumps(data),
    }


def err(message: str, status: int = 400) -> dict:
    return ok({"detail": message}, status)


def preflight() -> dict:
    return {
        "statusCode": 204,
        "headers": cors_headers(),
        "body": "",
    }
