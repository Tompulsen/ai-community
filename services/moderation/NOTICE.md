# Model and runtime attribution

The community service uses these independent upstream artifacts:

- **Falconsai/nsfw_image_detection**: the authors' Hugging Face model card declares Apache License 2.0. The classifier is a ViT fine-tuned on two classes, `normal` and `nsfw`. Source revision: `96cb0d0342c7afb80cab76ecc58b265fa44da256`. Source: https://huggingface.co/Falconsai/nsfw_image_detection
- **onnx-community/nsfw_image_detection-ONNX**: ONNX conversion of that model, as identified by its `base_model` and README. Conversion revision: `1ceb3c7fe1e9f3f2507e6df577437f23a9149fd5`. Its card does not declare a separate license. The source-model attribution and Apache 2.0 terms apply to the redistributed source model; this service makes no claim of ownership over the weights. Source: https://huggingface.co/onnx-community/nsfw_image_detection-ONNX
- **RapidOCR**: copyright RapidOCR Authors, Apache License 2.0. Code: https://github.com/RapidAI/RapidOCR . Runtime version is pinned in `requirements.txt`.
- **PaddleOCR PP-OCRv4** detector/recognizer and mobile orientation classifier: upstream weights belong to Baidu and/or the respective PaddleOCR rights holders and are distributed under Apache License 2.0. RapidOCR provides converted ONNX files under the same terms. Source: https://github.com/PaddlePaddle/PaddleOCR . Fixed conversion manifest: https://github.com/RapidAI/RapidOCR/blob/v3.3.1/python/rapidocr/default_models.yaml . ModelScope artifact revision: `v3.3.0`.
- **ONNX Runtime**: Microsoft, MIT License. https://github.com/microsoft/onnxruntime

All four model hashes and download addresses are recorded in `models.py`; downloaded bytes must match before use. Other runtime package licenses accompany their installed distributions. Apache License 2.0 is included in `APACHE-2.0.txt`.

NSFW scoring is not a general determination of legality or community compliance. The model does not identify violence, political content, age, copyright, or fraud. OCR only provides extracted text; community word policy is applied by the web service. False positives and false negatives are possible, including artistic, medical, animated and AI-generated imagery. Model-score thresholds require validation on representative community content.
