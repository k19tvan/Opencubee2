from pydantic import BaseModel


class AgentStartRequest(BaseModel):
    tab_id: str
    prompt: str
