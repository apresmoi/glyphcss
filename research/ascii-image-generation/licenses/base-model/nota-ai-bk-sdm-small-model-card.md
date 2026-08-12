---
license: creativeml-openrail-m
tags:
- stable-diffusion
- stable-diffusion-diffusers
- text-to-image
datasets:
  - ChristophSchuhmann/improved_aesthetics_6.5plus
library_name: diffusers
pipeline_tag: text-to-image
extra_gated_prompt: >-
  This model is open access and available to all, with a CreativeML OpenRAIL-M
  license further specifying rights and usage.

  The CreativeML OpenRAIL License specifies: 


  1. You can't use the model to deliberately produce nor share illegal or
  harmful outputs or content 

  2. The authors claim no rights on the outputs you generate, you are free to
  use them and are accountable for their use which must not go against the
  provisions set in the license

  3. You may re-distribute the weights and use the model commercially and/or as
  a service. If you do, please be aware you have to include the same use
  restrictions as the ones in the license and share a copy of the CreativeML
  OpenRAIL-M to all your users (please read the license entirely and carefully)

  Please read the full license carefully here:
  https://huggingface.co/spaces/CompVis/stable-diffusion-license
      
extra_gated_heading: Please read the LICENSE to access this model

---

# BK-SDM Model Card
Block-removed Knowledge-distilled Stable Diffusion Model (BK-SDM) is an architecturally compressed SDM for efficient general-purpose text-to-image synthesis. This model is bulit with (i) removing several residual and attention blocks from the U-Net of [Stable Diffusion v1.4]( https://huggingface.co/CompVis/stable-diffusion-v1-4) and (ii) distillation pretraining on only 0.22M LAION pairs (fewer than 0.1% of the full training set). Despite being trained with very limited resources, our compact model can imitate the original SDM by benefiting from transferred knowledge.
- **Resources for more information**: [Paper](https://arxiv.org/abs/2305.15798), [GitHub](https://github.com/Nota-NetsPresso/BK-SDM), [Demo]( https://huggingface.co/spaces/nota-ai/compressed-stable-diffusion).




## Examples with 🤗[Diffusers library](https://github.com/huggingface/diffusers).

An inference code with the default PNDM scheduler and 50 denoising steps is as follows.

```python
import torch
from diffusers import StableDiffusionPipeline

pipe = StableDiffusionPipeline.from_pretrained("nota-ai/bk-sdm-small", torch_dtype=torch.float16)
pipe = pipe.to("cuda")

prompt = "a tropical bird sitting on a branch of a tree"
image = pipe(prompt).images[0]  
    
image.save("example.png")
```

The following code is also runnable, because we compressed the U-Net of [Stable Diffusion v1.4]( https://huggingface.co/CompVis/stable-diffusion-v1-4) while keeping the other parts (i.e., Text Encoder and Image Decoder) unchanged:

```python
import torch
from diffusers import StableDiffusionPipeline, UNet2DConditionModel

pipe = StableDiffusionPipeline.from_pretrained("CompVis/stable-diffusion-v1-4", torch_dtype=torch.float16)
pipe.unet = UNet2DConditionModel.from_pretrained("nota-ai/bk-sdm-small", subfolder="unet", torch_dtype=torch.float16)
pipe = pipe.to("cuda")

prompt = "a tropical bird sitting on a branch of a tree"
image = pipe(prompt).images[0]  
    
image.save("example.png")
```




## Compression Method 

### U-Net Architecture
Certain residual and attention blocks were eliminated from the U-Net of SDM-v1.4:

- 1.04B-param [SDM-v1.4](https://huggingface.co/CompVis/stable-diffusion-v1-4) (0.86B-param U-Net): the original source model.
- 0.76B-param [**BK-SDM-Base**](https://huggingface.co/nota-ai/bk-sdm-base) (0.58B-param U-Net): obtained with ① fewer blocks in outer stages.
- 0.66B-param [**BK-SDM-Small**](https://huggingface.co/nota-ai/bk-sdm-small) (0.49B-param U-Net): obtained with ① and ② mid-stage removal.
- 0.50B-param [**BK-SDM-Tiny**](https://huggingface.co/nota-ai/bk-sdm-tiny) (0.33B-param U-Net): obtained with ①, ②, and ③ further inner-stage removal.


<center>
    <img alt="U-Net architectures" img src="https://netspresso-research-code-release.s3.us-east-2.amazonaws.com/assets-bk-sdm/fig_arch.png" width="100%">
</center>




### Distillation Pretraining
The compact U-Net was trained to mimic the behavior of the original U-Net. We leveraged feature-level and output-level distillation, along with the denoising task loss.


<center>
    <img alt="KD-based pretraining" img src="https://netspresso-research-code-release.s3.us-east-2.amazonaws.com/assets-bk-sdm/fig_kd_bksdm.png" width="100%">
</center>


<br/>

- **Training Data**: 212,776 image-text pairs (i.e., 0.22M pairs) from [LAION-Aesthetics V2 6.5+](https://laion.ai/blog/laion-aesthetics/).
- **Hardware:** A single NVIDIA A100 80GB GPU
- **Gradient Accumulations**: 4
- **Batch:** 256 (=4×64)
- **Optimizer:** AdamW
- **Learning Rate:** a constant learning rate of 5e-5 for 50K-iteration pretraining


## Experimental Results 

The following table shows the zero-shot results on 30K samples from the MS-COCO validation split. After generating 512×512 images with the PNDM scheduler and 25 denoising steps, we downsampled them to 256×256 for evaluating generation scores. Our models were drawn at the 50K-th training iteration.

| Model | FID↓ | IS↑ | CLIP Score↑<br>(ViT-g/14) | # Params,<br>U-Net | # Params,<br>Whole SDM |
|---|:---:|:---:|:---:|:---:|:---:|
| [Stable Diffusion v1.4](https://huggingface.co/CompVis/stable-diffusion-v1-4) | 13.05 | 36.76 | 0.2958 | 0.86B | 1.04B |
| [BK-SDM-Base](https://huggingface.co/nota-ai/bk-sdm-base) (Ours) | 15.76 | 33.79 | 0.2878 | 0.58B | 0.76B |
| [BK-SDM-Small](https://huggingface.co/nota-ai/bk-sdm-small) (Ours) | 16.98 | 31.68 | 0.2677 | 0.49B | 0.66B |
| [BK-SDM-Tiny](https://huggingface.co/nota-ai/bk-sdm-tiny) (Ours) | 17.12 | 30.09 | 0.2653 | 0.33B | 0.50B |

<br/>

The following figure depicts synthesized images with some MS-COCO captions.

<center>
    <img alt="Visual results" img src="https://netspresso-research-code-release.s3.us-east-2.amazonaws.com/assets-bk-sdm/fig_results.png" width="100%">
</center>


<br/>



# Uses 
_Note: This section is taken from the [Stable Diffusion v1 model card]( https://huggingface.co/CompVis/stable-diffusion-v1-4) (which was based on the [DALLE-MINI model card](https://huggingface.co/dalle-mini/dalle-mini)) and applies in the same way to BK-SDMs_.

## Direct Use 
The model is intended for research purposes only. Possible research areas and tasks include
- Safe deployment of models which have the potential to generate harmful content.
- Probing and understanding the limitations and biases of generative models.
- Generation of artworks and use in design and other artistic processes.
- Applications in educational or creative tools.
- Research on generative models.

Excluded uses are described below.

### Misuse, Malicious Use, and Out-of-Scope Use
The model should not be used to intentionally create or disseminate images that create hostile or alienating environments for people. This includes generating images that people would foreseeably find disturbing, distressing, or offensive; or content that propagates historical or current stereotypes.

#### Out-of-Scope Use
The model was not trained to be factual or true representations of people or events, and therefore using the model to generate such content is out-of-scope for the abilities of this model.

#### Misuse and Malicious Use
Using the model to generate content that is cruel to individuals is a misuse of this model. This includes, but is not limited to:

- Generating demeaning, dehumanizing, or otherwise harmful representations of people or their environments, cultures, religions, etc.
- Intentionally promoting or propagating discriminatory content or harmful stereotypes.
- Impersonating individuals without their consent.
- Sexual content without consent of the people who might see it.
- Mis- and disinformation
- Representations of egregious violence and gore
- Sharing of copyrighted or licensed material in violation of its terms of use.
- Sharing content that is an alteration of copyrighted or licensed material in violation of its terms of use.

## Limitations and Bias

### Limitations

- The model does not achieve perfect photorealism
- The model cannot render legible text
- The model does not perform well on more difficult tasks which involve compositionality, such as rendering an image corresponding to “A red cube on top of a blue sphere”
- Faces and people in general may not be generated properly.
- The model was trained mainly with English captions and will not work as well in other languages.
- The autoencoding part of the model is lossy
- The model was trained on a large-scale dataset [LAION-5B](https://laion.ai/blog/laion-5b/) which contains adult material and is not fit for product use without additional safety mechanisms and considerations.
- No additional measures were used to deduplicate the dataset. As a result, we observe some degree of memorization for images that are duplicated in the training data. The training data can be searched at [https://rom1504.github.io/clip-retrieval/](https://rom1504.github.io/clip-retrieval/) to possibly assist in the detection of memorized images.

### Bias

While the capabilities of image generation models are impressive, they can also reinforce or exacerbate social biases. Stable Diffusion v1 was trained on subsets of [LAION-2B(en)](https://laion.ai/blog/laion-5b/), which consists of images that are primarily limited to English descriptions. Texts and images from communities and cultures that use other languages are likely to be insufficiently accounted for. This affects the overall output of the model, as white and western cultures are often set as the default. Further, the ability of the model to generate content with non-English prompts is significantly worse than with English-language prompts.

### Safety Module

The intended use of this model is with the [Safety Checker](https://github.com/huggingface/diffusers/blob/main/src/diffusers/pipelines/stable_diffusion/safety_checker.py) in Diffusers. This checker works by checking model outputs against known hard-coded NSFW concepts. The concepts are intentionally hidden to reduce the likelihood of reverse-engineering this filter. Specifically, the checker compares the class probability of harmful concepts in the embedding space of the `CLIPTextModel` *after generation* of the images. The concepts are passed into the model with the generated image and compared to a hand-engineered weight for each NSFW concept.



# Acknowledgments
- We express our gratitude to [Microsoft for Startups Founders Hub](https://www.microsoft.com/en-us/startups) for generously providing the Azure credits used during pretraining.
- We deeply appreciate the pioneering research on Latent/Stable Diffusion conducted by [CompVis](https://github.com/CompVis/latent-diffusion), [Runway](https://runwayml.com/), and [Stability AI](https://stability.ai/).
- Special thanks to the contributors to [LAION](https://laion.ai/), [Diffusers](https://github.com/huggingface/diffusers), and [Gradio](https://www.gradio.app/) for their valuable support.


# Citation
```bibtex
@article{kim2023architectural,
  title={BK-SDM: A Lightweight, Fast, and Cheap Version of Stable Diffusion},
  author={Kim, Bo-Kyeong and Song, Hyoung-Kyu and Castells, Thibault and Choi, Shinkook},
  journal={arXiv preprint arXiv:2305.15798},
  year={2023},
  url={https://arxiv.org/abs/2305.15798}
}
```
```bibtex
@article{kim2023bksdm,
  title={BK-SDM: Architecturally Compressed Stable Diffusion for Efficient Text-to-Image Generation},
  author={Kim, Bo-Kyeong and Song, Hyoung-Kyu and Castells, Thibault and Choi, Shinkook},
  journal={ICML Workshop on Efficient Systems for Foundation Models (ES-FoMo)},
  year={2023},
  url={https://openreview.net/forum?id=bOVydU0XKC}
}
```

*This model card was written by Bo-Kyeong Kim and is based on the [Stable Diffusion v1 model card]( https://huggingface.co/CompVis/stable-diffusion-v1-4).*