import asyncio
from backend.services.search import get_embedding
from backend.core.config import TEMP_UPLOAD_DIR

async def main():
    import os
    files = os.listdir(TEMP_UPLOAD_DIR)
    if not files:
        print("No temp files")
        return
    img = files[0]
    print(f"Testing with {img}")
    emb = await get_embedding("beit3", image_name=img)
    print("Success" if emb else "Failed")

asyncio.run(main())
