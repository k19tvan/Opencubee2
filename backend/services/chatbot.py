from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, BaseMessage
from typing import Annotated, Literal
from typing_extensions import TypedDict
from langgraph.graph.message import add_messages
from langgraph.graph import StateGraph, START, END
from langgraph.checkpoint.memory import MemorySaver

search_model = ChatOpenAI(
    search_model_name="gemini-flash-lite",
    base_url="http://gemini-web2api:8081/v1",
    temperature=0.0,
    api_key="None",
)

class Option(TypedDict):
    option: str
    reason: str

class Options(TypedDict):
    options: list[Option]

search_model_with_structured = search_model.with_structured_output(schema=Options)

class State(TypedDict):
    options : Options
    messages : Annotated[list[BaseMessage], add_messages]
    isResearch : bool = False

def research_node(state: State):
    system_prompt = """
        Bạn là một chuyên gia về nghiên cứu, hãy tìm kiếm thông tin về nội dung sau trên các nền tảng internet:
        Sau khi có kết quả, hãy đoán xem người dùng đang muốn nói tới đối tượng (sự vật, sự việc, con người, địa danh, ...) nào và trả về 3 lựa chọn có khả năng nhất, kèm theo lý do tại sao bạn lại đưa ra lựa chọn đó.
        Trả lời ngắn gọn, xúc tích.
        Trả về kết quả theo định dạng JSON như sau:
        {
            "options": [
                {
                    "option": "Lựa chọn 1",
                    "reason": "Lý do lựa chọn 1"    
                },
                {
                    "option": "Lựa chọn 2",
                    "reason": "Lý do lựa chọn 2"    
                },
                {
                    "option": "Lựa chọn 3",
                    "reason": "Lý do lựa chọn 3"    
                }
            ],
        }
    """

    response = search_model_with_structured.invoke([SystemMessage(content=system_prompt), *state["messages"]])

    return {
        "options": response["options"],
        "messages": [AIMessage(content=str(response))]
    }

def chatbot_node(state: State):
    return {"messages": search_model.invoke(state["messages"])}

def route_decision(state: State) -> Literal["research", "chatbot"]:
    if state["isResearch"]:
        return "research"
    else:
        return "chatbot"

graph_builder = StateGraph(State)
graph_builder.add_node("research", research_node)
graph_builder.add_node("chatbot", chatbot_node)

graph_builder.add_conditional_edges(START, route_decision)
graph_builder.add_edge("research", END)
graph_builder.add_edge("chatbot", END)

memory = MemorySaver()
graph = graph_builder.compile(checkpointer=memory)

def chat(query: str, isResearch: bool = False):
    config = {"configurable": {"thread_id": 1}}
    initial_state = State(messages=[HumanMessage(content=query)], isResearch=isResearch)
    result = graph.invoke(initial_state, config)
    if isResearch: print(result["options"])
    else: print(result["messages"][-1].content)

import time
st = time.time()
chat("Người chạy nhanh nhất thế giới là ai?", isResearch=True)
chat("Tôi vừa hỏi gì?")
print(time.time() - st)
    




