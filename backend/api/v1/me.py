"""Per-user context for the authenticated client.

GET /me/features exposes ONLY module on/off flags to the frontend so nav can be
gated. tenants.feature_flags also holds payment-gateway secrets, so this endpoint
returns an explicit allowlist — never the raw JSONB. Absent key => enabled
(back-compat with schools provisioned before flags existed).
"""

import json

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/me", tags=["me"])

# Modules the frontend may toggle nav on. Anything not here (gateway secrets,
# internal flags) must never reach the client.
MODULE_FLAGS = ("attendance", "fees", "homework", "timetable", "exams", "cms")


class FeatureFlags(BaseModel):
    attendance: bool
    fees: bool
    homework: bool
    timetable: bool
    exams: bool
    cms: bool
    section_label: str = "Section"


@router.get("/features", response_model=FeatureFlags)
async def get_features(request: Request) -> FeatureFlags:
    flags = getattr(request.state, "feature_flags", {}) or {}
    if isinstance(flags, str):  # asyncpg returns JSONB as text (no codec set)
        flags = json.loads(flags or "{}")
    # absent => on
    return FeatureFlags(
        **{m: bool(flags.get(m, True)) for m in MODULE_FLAGS},
        section_label=str(flags.get("section_label", "Section")),
    )
