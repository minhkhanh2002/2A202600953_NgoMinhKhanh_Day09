def parse_policy_markdown(markdown_text: str) -> list[dict]:
    chunks = []
    lines = markdown_text.splitlines()
    
    current_h2 = None
    current_h3 = None
    current_content = []
    
    def flush():
        nonlocal current_h2, current_h3, current_content
        text = "\n".join(current_content).strip()
        if not text:
            return
        
        h2_clean = current_h2.strip() if current_h2 else ""
        h3_clean = current_h3.strip() if current_h3 else ""
        
        if h2_clean and h3_clean:
            citation = f"policy_mock_vi.md > {h2_clean} > {h3_clean}"
            rendered_text = f"## {h2_clean}\n### {h3_clean}\n{text}"
        elif h2_clean:
            citation = f"policy_mock_vi.md > {h2_clean}"
            rendered_text = f"## {h2_clean}\n{text}"
        else:
            citation = "policy_mock_vi.md"
            rendered_text = text
            
        chunks.append({
            "section_h2": h2_clean,
            "section_h3": h3_clean or None,
            "citation": citation,
            "rendered_text": rendered_text
        })
        current_content = []

    for line in lines:
        if line.startswith("## "):
            flush()
            current_h2 = line[3:].strip()
            current_h3 = None
        elif line.startswith("### "):
            flush()
            current_h3 = line[4:].strip()
        else:
            if current_h2 is not None:
                current_content.append(line)
                
    flush()
    return chunks

