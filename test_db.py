import asyncio
from backend.core import runtime
from backend.services.search import search_qdrant, search_ocr_on_meilisearch_async

async def main():
    runtime.startup_runtime()
    await asyncio.sleep(1)
    
    # query meilisearch
    ms_res = await search_ocr_on_meilisearch_async("cậu bé", 1)
    print("MeiliSearch result:", ms_res)
    
    # query qdrant (we just need one point, we can query collection 'bge' with dummy vector)
    try:
        if runtime.qdrant_client:
            res = runtime.qdrant_client.scroll(collection_name="bge", limit=1)
            print("Qdrant result:", res[0][0].payload)
    except Exception as e:
        print("Qdrant err:", e)
        
    await runtime.shutdown_runtime()

asyncio.run(main())
