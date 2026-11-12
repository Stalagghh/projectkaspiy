"""Bearer token check for every endpoint except /healthz."""

import hmac

from fastapi import Header, HTTPException, status

from app.settings import get_settings


def require_token(authorization: str | None = Header(default=None)) -> None:
    """Accept the request only if it carries "Authorization: Bearer <ML_API_TOKEN>".

    hmac.compare_digest compares in constant time, so the response time does not
    reveal how many characters of a guessed token were correct.
    """
    expected = get_settings().ml_api_token
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token.strip().encode(), expected.encode()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="unauthorized",
            headers={"WWW-Authenticate": "Bearer"},
        )
