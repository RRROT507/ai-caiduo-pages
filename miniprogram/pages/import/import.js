Page({
  data: {
    fileName: "尚未选择"
  },

  chooseStatementFile() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["pdf", "txt", "csv"],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        this.setData({ fileName: file ? file.name : "尚未选择" });
        wx.showToast({ title: "已选择文件", icon: "success" });
      }
    });
  },

  showOcrNotice() {
    wx.showModal({
      title: "需要云端识别",
      content: "PDF 自动解析需要把文件交给云端 OCR/AI 服务处理。建议下一步接入微信云开发或腾讯云 OCR 后，再开放自动入账。",
      showCancel: false
    });
  }
});
