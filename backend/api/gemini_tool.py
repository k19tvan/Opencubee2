import asyncio
from concurrent.futures import ThreadPoolExecutor
import os
import queue
import threading
import time
from typing import Optional, Type, Any
from pydantic import BaseModel, Field, PrivateAttr
from langchain_core.tools import BaseTool

class GeminiStealthBot:
    """Tool cào dữ liệu Gemini tích hợp kỹ thuật chống phát hiện Bot"""

    def __init__(self, headless: bool = True, session_dir: str = "./gemini_session", timeout: int = 90):
        self.headless = headless
        self.session_dir = session_dir
        self.timeout = timeout * 1000  # Chuyển sang ms
        self.playwright = None
        self.context = None
        self.page = None

    def _apply_stealth_scripts(self, page):
        """Bơm các script JS để xóa hoàn toàn dấu vết Playwright"""
        page.add_init_script("""
            // 1. Xóa thuộc tính navigator.webdriver
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

            // 2. Giả lập window.chrome
            window.chrome = {
                runtime: {},
                loadTimes: function() {},
                csi: function() {},
                app: {}
            };

            // 3. Giả lập danh sách Plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5],
            });

            // 4. Giả lập ngôn ngữ
            Object.defineProperty(navigator, 'languages', {
                get: () => ['vi-VN', 'vi', 'en-US', 'en'],
            });

            // 5. Override Permissions API
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        """)

    def start(self):
        """Khởi động trình duyệt stealth"""
        if self.page and not self.page.is_closed():
            return

        # Import lazily so the rest of the FastAPI backend can still start and
        # report a useful research error when Playwright is not installed.
        from playwright.sync_api import sync_playwright

        user_agent_that = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        )

        chrome_args = [
            "--disable-blink-features=AutomationControlled",
            "--start-maximized",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-infobars",
            "--ignore-certificate-errors",
        ]

        self.playwright = sync_playwright().start()
        
        # Dùng persistent_context để giữ Cookie/Session không bị Google hỏi lại
        self.context = self.playwright.chromium.launch_persistent_context(
            user_data_dir=self.session_dir,
            headless=self.headless,
            user_agent=user_agent_that,
            viewport={"width": 1920, "height": 1080},
            locale="vi-VN",
            timezone_id="Asia/Ho_Chi_Minh",
            args=chrome_args
        )

        self.page = self.context.pages[0] if self.context.pages else self.context.new_page()
        self._apply_stealth_scripts(self.page)

    def ask(self, question: str) -> str:
        """Thực thi gửi câu hỏi và trích xuất câu trả lời"""
        try:
            self.start()

            # Mở Gemini nếu chưa ở trang này
            if "gemini.google.com" not in self.page.url:
                self.page.goto("https://gemini.google.com/app", wait_until="domcontentloaded")

            # Bước 1: Chờ ô nhập câu hỏi
            input_selector = (
                "rich-textarea div[contenteditable='true'], "
                "div.ql-editor, div[contenteditable='true'], textarea"
            )
            
            self.page.wait_for_selector(input_selector, timeout=self.timeout)
            # Tương tác tự nhiên
            self.page.click(input_selector)
            self.page.keyboard.press("Control+A")
            self.page.keyboard.press("Backspace")
            previous_response_count = self.page.locator("message-content").count()
            
            # Dùng type với delay nhẹ (10ms) để giống người gõ thật, kích hoạt event JS
            self.page.keyboard.type(question, delay=10)
            time.sleep(0.3)
            self.page.keyboard.press("Enter")            
            # Wait for a new answer instead of accidentally re-reading a
            # previous message that is already present in this profile.
            self.page.wait_for_function(
                "previous => document.querySelectorAll('message-content').length > previous",
                arg=previous_response_count,
                timeout=self.timeout,
            )

            # Gemini does not expose a stable completion event. Treat the last
            # answer as complete after its text remains unchanged for ~2s.
            response_element = self.page.locator("message-content").last
            deadline = time.monotonic() + (self.timeout / 1000)
            answer_text = ""
            stable_reads = 0
            while time.monotonic() < deadline and stable_reads < 3:
                current_text = response_element.inner_text().strip()
                if current_text and current_text == answer_text:
                    stable_reads += 1
                else:
                    answer_text = current_text
                    stable_reads = 0
                time.sleep(0.75)
            if not answer_text:
                raise RuntimeError("Gemini returned an empty response.")
            return answer_text

        except Exception as e:
            if self.page:
                error_path = os.path.join(self.session_dir, "gemini_error.png")
                os.makedirs(self.session_dir, exist_ok=True)
                self.page.screenshot(path=error_path)
            raise RuntimeError(f"Có lỗi xảy ra khi gọi Gemini: {e}") from e

    def close(self):
        """Đóng tài nguyên"""
        if self.context:
            self.context.close()
        if self.playwright:
            self.playwright.stop()
        self.page = None


class GeminiToolInput(BaseModel):
    question: str = Field(description="Câu hỏi hoặc nội dung cần gửi cho Gemini.")

class GeminiLangChainTool(BaseTool):
    name: str = "google_gemini_tool"
    description: str = "Hữu ích khi cần hỏi đáp hoặc sinh nội dung từ Google Gemini."
    args_schema: Type[BaseModel] = GeminiToolInput

    session_dir: str = "./gemini_session"
    headless: bool = True
    timeout: int = 90

    _bot: Any = PrivateAttr(default=None)
    _lock: Any = PrivateAttr(default_factory=threading.Lock)

    def _run(self, question: str) -> str:
        with self._lock:
            if not self._bot:
                self._bot = GeminiStealthBot(
                    headless=self.headless,
                    session_dir=self.session_dir,
                    timeout=self.timeout
                )
            return self._bot.ask(question)

    def close(self):
        if self._bot:
            self._bot.close()


class GeminiToolPool:
    """Lease one of several isolated persistent Gemini browser profiles."""

    def __init__(
        self,
        size: int = 5,
        session_root: str = "./gemini_sessions",
        headless: bool = True,
        session_dirs: Optional[list[str]] = None,
        timeout: int = 90,
    ):
        configured_dirs = [path.strip() for path in (session_dirs or []) if path.strip()]
        self.size = len(configured_dirs) or max(1, size)
        self.session_root = session_root
        os.makedirs(self.session_root, exist_ok=True)
        self._available: queue.Queue[tuple[GeminiLangChainTool, ThreadPoolExecutor]] = queue.Queue(maxsize=self.size)
        profile_dirs = configured_dirs or [
            os.path.join(self.session_root, f"session_{index + 1}")
            for index in range(self.size)
        ]
        for profile_dir in profile_dirs:
            tool = GeminiLangChainTool(headless=headless, session_dir=profile_dir, timeout=timeout)
            # Playwright's sync API is thread-affine. A one-thread executor per
            # profile guarantees that a persistent browser is always reused on
            # the same OS thread across requests.
            executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="gemini-profile")
            self._available.put((tool, executor))

    async def ask(self, question: str) -> str:
        lease = await asyncio.to_thread(self._available.get)
        tool, executor = lease
        try:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(executor, tool.invoke, {"question": question})
        finally:
            self._available.put(lease)

    def close(self):
        leases = []
        while not self._available.empty():
            leases.append(self._available.get_nowait())
        for tool, executor in leases:
            executor.submit(tool.close).result(timeout=15)
            executor.shutdown(wait=True)

if __name__ == "__main__":
    langchain_tool = GeminiLangChainTool(headless=True)
    result = langchain_tool.invoke({"question": "Thành phố ánh sáng là gì?"})
    print(result)
