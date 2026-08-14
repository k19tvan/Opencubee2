from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForCausalLM, AutoTokenizer


def _as_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


class FGClip2Embedder:
    """Local FG-CLIP 2 encoder shared by the serving worker and indexer."""

    def __init__(self) -> None:
        self.device = os.getenv(
            "FGCLIP2_DEVICE", "cuda:0" if torch.cuda.is_available() else "cpu"
        )
        self.model_path = Path(
            os.getenv("FGCLIP2_MODEL_PATH", "./models/fg-clip2-large")
        )
        self.local_files_only = _as_bool(
            os.getenv("FGCLIP2_LOCAL_FILES_ONLY", "true")
        )
        self.text_max_length = int(os.getenv("FGCLIP2_TEXT_MAX_LENGTH", "64"))
        self.text_walk_type = os.getenv("FGCLIP2_TEXT_WALK_TYPE", "short")

        if not self.model_path.is_dir():
            raise FileNotFoundError(
                f"FG-CLIP 2 model not found: {self.model_path}. "
                "Download it before starting the worker."
            )

        source = str(self.model_path)
        options = {
            "local_files_only": self.local_files_only,
            "trust_remote_code": True,
        }
        self.tokenizer = AutoTokenizer.from_pretrained(source, **options)
        self.image_processor = AutoImageProcessor.from_pretrained(source, **options)
        self.model = AutoModelForCausalLM.from_pretrained(source, **options)
        self.model.to(self.device)
        self.model.eval()

    @staticmethod
    def _max_image_patches(image: Image.Image) -> int:
        width, height = image.size
        patches = (width // 16) * (height // 16)
        if patches > 784:
            return 1024
        if patches > 576:
            return 784
        if patches > 256:
            return 576
        if patches > 128:
            return 256
        return 128

    @staticmethod
    def _normalize(embedding: torch.Tensor) -> np.ndarray:
        embedding = torch.nn.functional.normalize(embedding.float(), dim=-1)
        return embedding.squeeze(0).cpu().numpy()

    def embed_text(self, text: str) -> np.ndarray:
        if not text.strip():
            raise ValueError("Text query must not be empty.")

        tokens = self.tokenizer(
            [text.lower()],
            padding="max_length",
            max_length=self.text_max_length,
            truncation=True,
            return_tensors="pt",
        ).to(self.device)
        with torch.inference_mode():
            embedding = self.model.get_text_features(
                **tokens, walk_type=self.text_walk_type
            )
        return self._normalize(embedding)

    def embed_image(self, image: Image.Image) -> np.ndarray:
        inputs = self.image_processor(
            images=image.convert("RGB"),
            max_num_patches=self._max_image_patches(image),
            return_tensors="pt",
        ).to(self.device)
        with torch.inference_mode():
            embedding = self.model.get_image_features(**inputs)
        return self._normalize(embedding)
